import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage, UIMessageChunk } from 'ai'
import * as _ai from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import {
  actionPolicyIdForCandidate,
  DbActionPolicyStore,
} from '../../../src/agent/action-policy'
import * as mcpBuilderModule from '../../../src/agent/mcp-builder'
import * as providerFactoryModule from '../../../src/agent/provider-factory'
import * as researchSupportModule from '../../../src/agent/research-support-assessment'
import type { KlavisProxyStatus } from '../../../src/api/services/klavis'
import { consumeApprovalOperation } from '../../../src/lib/conversations/approval-operation-ledger'
import { DbConversationStore } from '../../../src/lib/conversations/conversation-store'
import { closeDb, getDbHandle, initializeDb } from '../../../src/lib/db'

type MockMessage = UIMessage

interface MockAgent {
  toolLoopAgent: object
  toolNames: Set<string>
  messages: MockMessage[]
  appendUserMessage(text: string): void
  dispose(): Promise<void>
}

interface StoredSession {
  agent: MockAgent
  scheduledPageId?: number
}

const BROWSEROS_TARGET = { type: 'browseros', providerId: 'browseros' } as const
const realCreateAgentUIStream = _ai.createAgentUIStream
const realCreateLanguageModel = providerFactoryModule.createLanguageModel
const realSerializesReasoningContent =
  providerFactoryModule.serializesReasoningContent
const realCreateMcpClients = mcpBuilderModule.createMcpClients

interface StreamResponseOptions {
  uiMessages?: MockMessage[]
  abortSignal?: AbortSignal
  options?: { taskId: string; approvalId?: string }
  onError?: (error: unknown) => string
  onFinish(args: { messages: MockMessage[] }): Promise<void>
}

let agentToReturn: MockAgent | undefined
let includeFinishChunk = false
let finishMessagesForMock: MockMessage[] | undefined
let streamResponseHandler:
  | ((options: StreamResponseOptions) => Promise<Response>)
  | undefined
let useProductionAgentFixture = false
let productionToolDispatches: unknown[] = []
let productionModelCalls = 0
let productionModelGate: Promise<void> | undefined
let productionModelStarted: (() => void) | undefined
let productionModelToolCallProduced: (() => void) | undefined
let productionModelToolCallWasAborted = false
let productionToolCallOverride:
  | { toolName: string; input: Record<string, unknown> }
  | undefined

const productionFixtureModel = new MockLanguageModelV3({
  doStream: async ({ abortSignal }) => {
    productionModelCalls += 1
    if (productionModelGate) {
      productionModelStarted?.()
      await productionModelGate
    }
    const part =
      productionModelCalls % 2 === 1
        ? {
            type: 'tool-call' as const,
            toolCallId: `provider-send-call-${productionModelCalls}`,
            toolName: productionToolCallOverride?.toolName ?? 'send_message',
            input: JSON.stringify(
              productionToolCallOverride?.input ?? {
                destination: 'user@example.test',
                body: 'hello',
              },
            ),
          }
        : {
            type: 'text-delta' as const,
            id: 'answer',
            delta: 'Handled the request.',
          }
    const finishReason = {
      unified:
        part.type === 'tool-call' ? ('tool-calls' as const) : ('stop' as const),
      raw: part.type === 'tool-call' ? 'tool_calls' : 'stop',
    }
    const result = {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          if (part.type === 'tool-call') controller.enqueue(part)
          else {
            controller.enqueue({ type: 'text-start', id: part.id })
            controller.enqueue(part)
            controller.enqueue({ type: 'text-end', id: part.id })
          }
          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: {
              inputTokens: { total: 1, noCache: 1 },
              outputTokens: { total: 1, text: 1 },
            },
          })
          controller.close()
        },
      }),
    }
    if (part.type === 'tool-call') {
      productionModelToolCallWasAborted = abortSignal?.aborted === true
      productionModelToolCallProduced?.()
    }
    return result
  },
})

const createAgentSpy = mock(async (config: unknown) => {
  if (!agentToReturn) {
    throw new Error(`No mock agent configured for ${JSON.stringify(config)}`)
  }
  return agentToReturn
})

const createAgentUIStreamSpy = mock(async (options: StreamResponseOptions) => {
  if (useProductionAgentFixture) {
    return realCreateAgentUIStream(options as never)
  }
  if (!streamResponseHandler) {
    throw new Error('No stream response handler configured')
  }
  const response = await streamResponseHandler(options)
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let emittedFinish = false
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      if (!reader) {
        controller.close()
        return
      }
      const { done, value } = await reader.read()
      if (done) {
        if (includeFinishChunk && !emittedFinish) {
          emittedFinish = true
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          return
        }
        if (includeFinishChunk && finishMessagesForMock) {
          const messages = finishMessagesForMock
          finishMessagesForMock = undefined
          await options.onFinish({ messages })
        }
        controller.close()
        return
      }
      controller.enqueue({
        type: 'text-delta',
        id: 'mock-answer',
        delta: decoder.decode(value),
      })
    },
    async cancel(reason) {
      await reader?.cancel(reason)
    },
  })
})

const generateObjectSpy = mock(async (_options: unknown) => ({
  object: {
    assessments: [
      {
        claim: 'The answer is supported.',
        support: 'supported',
        explanation: 'The captured page supports it.',
      },
    ],
  },
}))

const resolveLLMConfigSpy = mock(async () => ({
  provider: 'openai',
  model: 'gpt-5',
  apiKey: 'test-key',
}))
const loggerErrorSpy = mock(
  (_message: string, _fields: Record<string, unknown>) => {},
)

// Spread the real `ai` module so other test files in the same
// bun-test process that import { tool } / { UIMessage } / etc. from
// `ai` still get real exports. Without the spread, this partial mock
// wipes the `ai` module in Bun's process-scoped mock registry and
// unrelated files blow up at load with `SyntaxError: Export named
// 'tool' not found in module .../ai/dist/index.mjs`. Reproducible on
// Linux CI's file-load order but benign on macOS APFS. See the
// 2026-07-17 test reliability audit for the failure mechanism.
mock.module('ai', () => ({
  ..._ai,
  createAgentUIStream: createAgentUIStreamSpy,
  generateObject: generateObjectSpy,
}))

mock.module('../../../src/agent/provider-factory', () => ({
  ...providerFactoryModule,
  createLanguageModel: async (
    ...args: Parameters<typeof providerFactoryModule.createLanguageModel>
  ) =>
    useProductionAgentFixture
      ? { model: productionFixtureModel }
      : realCreateLanguageModel(...args),
  serializesReasoningContent: (
    ...args: Parameters<typeof providerFactoryModule.serializesReasoningContent>
  ) =>
    useProductionAgentFixture ? false : realSerializesReasoningContent(...args),
}))

mock.module('../../../src/agent/mcp-builder', () => ({
  ...mcpBuilderModule,
  createMcpClients: async (specs: Array<{ name: string }> = []) => {
    if (!useProductionAgentFixture) {
      return realCreateMcpClients(specs as never)
    }
    return {
      clients: [],
      tools: specs.some((spec) => spec.name === 'browseros')
        ? {}
        : productionToolCallOverride?.toolName === 'tabs'
          ? {
              tabs: {
                description: 'Open a browser tab.',
                inputSchema: z.object({
                  action: z.enum(['new']),
                  url: z.string().optional(),
                  background: z.boolean().optional(),
                }),
                execute: async (input: {
                  action: string
                  url?: string
                  background?: boolean
                }) => {
                  productionToolDispatches.push(input)
                  return { pageId: 42 }
                },
              },
            }
          : {
              send_message: {
                description: 'Send a message to the selected recipient.',
                inputSchema: z.object({
                  destination: z.string(),
                  body: z.string(),
                }),
                execute: async (input: {
                  destination: string
                  body: string
                }) => {
                  productionToolDispatches.push(input)
                  return { sent: true }
                },
              },
            },
    }
  },
}))

// Capture the production implementation before registering the ordinary unit
// fixture below. The integration case selects it explicitly via its flag.
const { AiSdkAgent: ProductionAiSdkAgent } = await import(
  '../../../src/agent/ai-sdk-agent'
)

mock.module('../../../src/agent/ai-sdk-agent', () => ({
  AiSdkAgent: {
    create: (config: unknown) =>
      useProductionAgentFixture
        ? ProductionAiSdkAgent.create(config as never)
        : createAgentSpy(config),
  },
}))

// A module factory is a total replacement: anything it omits disappears for
// every file that imports this module afterwards, and bun's registry is
// process wide, so the failure surfaces somewhere else entirely and only when
// file ordering puts that file second. Re-export the real module and override
// the one function under test.
import * as llmConfigModule from '../../../src/lib/clients/llm/config'

mock.module('../../../src/lib/clients/llm/config', () => ({
  ...llmConfigModule,
  resolveLLMConfig: resolveLLMConfigSpy,
}))

mock.module('../../../src/lib/logger', () => ({
  logger: {
    error: loggerErrorSpy,
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}))

const { ChatService: RealChatService } = await import(
  '../../../src/api/services/chat-service'
)
const { ServerActivity } = await import(
  '../../../src/api/services/server-activity'
)

let leaseSequence = 0
function createBrowserMcpStub() {
  return {
    createLease: mock(() => ({
      token: `test-lease-${++leaseSequence}`,
      updateBrowserContext: mock(() => {}),
      revoke: mock(() => {}),
    })),
  }
}

// Individual tests only specify dependencies relevant to their behavior. Keep
// the new authoritative runtime seam real at the constructor boundary without
// repeating an unrelated lease stub in every fixture.
const ChatService = class extends RealChatService {
  constructor(deps: ConstructorParameters<typeof RealChatService>[0]) {
    super({
      serverPort: 32123,
      browserMcp: createBrowserMcpStub() as never,
      heartbeatContinuationResolver: async () => false,
      ...deps,
    })
  }
}

function createKlavisStub(
  getStatus: () => KlavisProxyStatus = () => ({
    state: 'stopped',
  }),
) {
  return {
    getProxyStatus: getStatus,
    buildAiSdkToolSet: mock(() => ({})),
    registerMcpTools: mock(() => {}),
  }
}

function createSessionStore() {
  const sessions = new Map<string, StoredSession>()
  return {
    get(conversationId: string) {
      return sessions.get(conversationId)
    },
    set(conversationId: string, session: StoredSession) {
      sessions.set(conversationId, session)
    },
    remove(conversationId: string) {
      return sessions.delete(conversationId)
    },
    async delete(conversationId: string) {
      const session = sessions.get(conversationId)
      if (!session) return false
      await session.agent.dispose()
      sessions.delete(conversationId)
      return true
    },
    count() {
      return sessions.size
    },
  }
}

describe('ChatService research support assessment', () => {
  afterEach(() => {
    includeFinishChunk = false
    finishMessagesForMock = undefined
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })

  it('assesses only opted-in explicit research with the request provider and streams before finish', async () => {
    includeFinishChunk = true
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai-compatible',
      providerId: 'selected-provider',
      model: 'selected-model',
      apiKey: 'selected-key',
      baseUrl: 'https://llm.example.test/v1',
    }))
    generateObjectSpy.mockClear()
    generateObjectSpy.mockImplementation(async (options) => {
      const prompt = JSON.parse((options as { prompt: string }).prompt) as {
        evidence: Array<{ id: string }>
      }
      const sourceId = prompt.evidence[0]?.id
      return {
        object: {
          assessments: [
            {
              claim: 'The answer is supported.',
              support: 'supported',
              explanation: 'The captured page supports it.',
              sourceIds: sourceId ? [sourceId] : [],
              quoteEvidence: sourceId
                ? [{ sourceId, quote: 'captured page evidence' }]
                : [],
            },
          ],
        },
      }
    })

    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    streamResponseHandler = async ({ options }) => {
      researchSupportModule.captureSuccessfulBuiltInRead(
        options?.taskId ?? '',
        { text: 'captured page evidence' },
      )
      finishMessagesForMock = [
        ...fakeAgent.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [{ type: 'text', text: 'A researched answer.' }],
        },
      ]
      return new Response('A researched answer.')
    }

    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: {
        resolveTabIds: mock(async () => new Map<number, number>()),
        newPage: mock(async () => 91),
        listPages: mock(async () => []),
        closePage: mock(async () => {}),
      } as never,
      registry: {} as never,
    })
    const baseRequest = {
      target: BROWSEROS_TARGET,
      persist: false,
      message:
        'Research request (Aster, explicit user initiation): Compare the latest results.',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      assessResearchSupport: true,
      providerId: 'selected-provider',
    }

    for (const request of [
      { ...baseRequest, assessResearchSupport: false },
      {
        ...baseRequest,
        message: 'What is the capital of France?',
      },
      { ...baseRequest, isScheduledTask: true },
      { ...baseRequest, mode: 'chat' },
    ]) {
      const negativeResponse = await service.processMessage(
        {
          ...request,
          conversationId: crypto.randomUUID(),
        } as never,
        new AbortController().signal,
      )
      await negativeResponse.text()
    }

    expect(generateObjectSpy).not.toHaveBeenCalled()

    const response = await service.processMessage(
      {
        ...baseRequest,
        conversationId: crypto.randomUUID(),
      } as never,
      new AbortController().signal,
    )
    const streamText = await response.text()

    expect(generateObjectSpy).toHaveBeenCalledTimes(1)
    const resolvedRequest = resolveLLMConfigSpy.mock.calls.at(-1)?.[0] as {
      providerId?: string
    }
    expect(resolvedRequest.providerId).toBe('selected-provider')
    const generationArgs = generateObjectSpy.mock.calls[0]?.[0] as {
      model?: { provider?: string; modelId?: string }
      prompt?: string
    }
    expect(generationArgs.model).toMatchObject({
      provider: 'openai-compatible.chat',
      modelId: 'selected-model',
    })
    expect(generationArgs.prompt).toContain('A researched answer.')
    expect(generationArgs.prompt).toContain('captured page evidence')

    const assessmentIndex = streamText.indexOf('data-a11Support')
    const finishIndex = streamText.indexOf('"type":"finish"')
    expect(assessmentIndex).toBeGreaterThanOrEqual(0)
    expect(finishIndex).toBeGreaterThan(assessmentIndex)
    expect(streamText).toContain('The answer is supported.')
    expect(streamText).toContain('captured page evidence')
  })
})

describe('ChatService file attachments', () => {
  beforeEach(() => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })

  it('delivers selected files to the current model turn and retains them in completed history only', async () => {
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    const modelPrompts: MockMessage[][] = []
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: {
        resolveTabIds: mock(async () => new Map<number, number>()),
        closePage: mock(async () => {}),
      } as never,
    })
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      const prompt = uiMessages ?? []
      modelPrompts.push(prompt)
      await onFinish({
        messages: [
          ...prompt,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: 'File received.' }],
          },
        ],
      })
      return new Response('ok')
    }

    const conversationId = crypto.randomUUID()
    const response = await service.processMessage(
      {
        target: BROWSEROS_TARGET,
        persist: false,
        conversationId,
        message: 'Read this selected file.',
        attachments: [
          {
            mediaType: 'text/plain',
            data: 'data:text/plain;base64,c2VudGluZWw=',
            name: 'selected.txt',
          },
        ],
        isScheduledTask: false,
        mode: 'agent',
        origin: 'sidepanel',
      } as never,
      new AbortController().signal,
    )
    await response.text()

    const userPrompt = modelPrompts[0]?.find(
      (message) => message.role === 'user',
    )
    expect(userPrompt?.parts).toEqual([
      {
        type: 'text',
        text: '<USER_QUERY>\nRead this selected file.\n</USER_QUERY>',
      },
      {
        type: 'file',
        mediaType: 'text/plain',
        url: 'data:text/plain;base64,c2VudGluZWw=',
        filename: 'selected.txt',
      },
    ])
    const completedUserMessage = fakeAgent.messages.find(
      (message) => message.role === 'user',
    )
    expect(completedUserMessage?.parts).toEqual([
      { type: 'text', text: 'Read this selected file.' },
      {
        type: 'file',
        mediaType: 'text/plain',
        url: 'data:text/plain;base64,c2VudGluZWw=',
        filename: 'selected.txt',
      },
    ])

    const nextResponse = await service.processMessage(
      {
        target: BROWSEROS_TARGET,
        persist: false,
        conversationId,
        message: 'Now answer a follow-up without resending the file.',
        isScheduledTask: false,
        mode: 'agent',
        origin: 'sidepanel',
      } as never,
      new AbortController().signal,
    )
    await nextResponse.text()

    const secondTurnUsers = modelPrompts[1]?.filter(
      (message) => message.role === 'user',
    )
    expect(secondTurnUsers).toHaveLength(2)
    expect(
      secondTurnUsers?.[0]?.parts.some((part) => part.type === 'file'),
    ).toBe(false)
    expect(secondTurnUsers?.[1]?.parts).toEqual([
      {
        type: 'text',
        text: '<USER_QUERY>\nNow answer a follow-up without resending the file.\n</USER_QUERY>',
      },
    ])
    expect(
      fakeAgent.messages
        .find((message) => message.role === 'user')
        ?.parts.some((part) => part.type === 'file'),
    ).toBe(true)
  })
})

function createFakeAgent() {
  const messages: MockMessage[] = []
  return {
    toolLoopAgent: {},
    toolNames: new Set(['probe']),
    messages,
    appendUserMessage(text: string) {
      // Mirror production's id-per-call: a hardcoded constant would
      // collide on repeat calls in the same agent instance and corrupt
      // the id-diff logic the ACP onFinish branch relies on.
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text }],
      })
    },
    dispose: mock(async () => {}),
  }
}

describe('ChatService activity tracking', () => {
  it('passes each run UUID into tool execution context on a shared conversation agent', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    const taskIds: Array<string | undefined> = []
    streamResponseHandler = async ({ onFinish, uiMessages, options }) => {
      taskIds.push(options?.taskId)
      await onFinish({ messages: uiMessages ?? fakeAgent.messages })
      return new Response('ok')
    }

    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: {
        resolveTabIds: mock(async () => new Map<number, number>()),
        closePage: mock(async () => {}),
      } as never,
      serverPort: 32123,
    })
    const conversationId = crypto.randomUUID()
    const request = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId,
      message: 'same conversation, separate run',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
    } as never

    const runIds: string[] = []
    for (let index = 0; index < 2; index += 1) {
      const response = await service.processMessage(
        request,
        new AbortController().signal,
      )
      runIds.push(response.headers.get('x-browseros-run-id') ?? '')
      await response.text()
    }

    expect(runIds[0]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(runIds[1]).toMatch(/^[0-9a-f-]{36}$/i)
    expect(runIds[0]).not.toBe(runIds[1])
    expect(taskIds).toEqual(runIds)
    expect(agentToReturn).toBe(fakeAgent)
  })

  it('stays busy when a subscriber disconnects and idles on explicit stop', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    streamResponseHandler = async () => {
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: partial\n\n'))
          },
        }),
      )
    }

    const activity = new ServerActivity()
    const browser = {
      resolveTabIds: mock(async () => new Map<number, number>()),
      closePage: mock(async () => {}),
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: browser as never,
      browserSession: { pages: {} } as never,
      serverPort: 32123,
      activity,
    })

    const conversationId = crypto.randomUUID()
    const response = await service.processMessage(
      {
        target: BROWSEROS_TARGET,
        persist: false,
        conversationId,
        message: 'stop after the first chunk',
        isScheduledTask: false,
        mode: 'agent',
        origin: 'sidepanel',
        browserContext: {
          activeTab: {
            id: 3,
            url: 'https://example.com',
            title: 'Example',
          },
        },
      } as never,
      new AbortController().signal,
    )

    expect(activity.isBusy()).toBe(true)
    const serverRunId = response.headers.get('x-browseros-run-id')
    expect(serverRunId).toBeTruthy()
    expect((await service.getRunSnapshot(conversationId))?.runId).toBe(
      serverRunId,
    )
    const reader = response.body?.getReader()
    await reader?.read()

    await reader?.cancel()
    expect(activity.isBusy()).toBe(true)

    expect(await service.stop(conversationId)).toBe(true)
    expect(activity.isBusy()).toBe(false)
  })
})

describe('ChatService scheduled task page lifecycle', () => {
  it('creates and cleans up a background page without creating a window', async () => {
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? fakeAgent.messages })
      return new Response('ok')
    }

    const browser = {
      newPage: mock(async () => 77),
      listPages: mock(async () => [
        {
          pageId: 77,
          windowId: 11,
        },
      ]),
      closePage: mock(async () => {}),
      createWindow: mock(async () => ({ windowId: 11 })),
      closeWindow: mock(async () => {}),
      resolveTabIds: mock(async () => new Map<number, number>()),
    }
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: browser as never,
      registry: {} as never,
    })

    await service.processMessage(
      {
        target: BROWSEROS_TARGET,
        persist: false,
        conversationId: crypto.randomUUID(),
        message: 'Run the scheduled task',
        isScheduledTask: true,
        mode: 'agent',
        origin: 'sidepanel',
        browserContext: {
          windowId: 9,
          activeTab: {
            id: 3,
            url: 'https://example.com',
            title: 'Example',
          },
          selectedTabs: [{ id: 4 }],
          enabledMcpServers: ['slack'],
        },
      } as never,
      new AbortController().signal,
    )

    expect(browser.newPage).toHaveBeenCalledWith('about:blank', {
      background: true,
    })
    expect(browser.createWindow).not.toHaveBeenCalled()
    expect(browser.closePage).toHaveBeenCalledWith(77)
    expect(browser.closeWindow).not.toHaveBeenCalled()

    const createArgs = createAgentSpy.mock.calls.at(-1)?.[0] as {
      browserContext?: {
        windowId?: number
        selectedTabs?: unknown[]
        activeTab?: {
          id: number
          pageId: number
          url: string
          title: string
        }
        enabledMcpServers?: string[]
      }
    }
    expect(createArgs.browserContext?.windowId).toBe(11)
    expect(createArgs.browserContext?.selectedTabs).toBeUndefined()
    expect(createArgs.browserContext?.activeTab).toEqual({
      id: 77,
      pageId: 77,
      url: 'about:blank',
      title: 'Scheduled Task',
    })
    expect(createArgs.browserContext?.enabledMcpServers).toEqual(['slack'])
  })

  it('deleteSession closes the tracked scheduled page', async () => {
    const fakeAgent = createFakeAgent()
    const sessionStore = createSessionStore()
    const browser = {
      closePage: mock(async () => {}),
    }
    const conversationId = crypto.randomUUID()

    sessionStore.set(conversationId, {
      agent: fakeAgent,
      scheduledPageId: 33,
    })

    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: browser as never,
      registry: {} as never,
    })

    const result = await service.deleteSession(conversationId)

    expect(result).toEqual({ deleted: true, sessionCount: 0 })
    expect(browser.closePage).toHaveBeenCalledWith(33)
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the scheduled page context when metadata lookup fails', async () => {
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? fakeAgent.messages })
      return new Response('ok')
    }

    const browser = {
      newPage: mock(async () => 88),
      listPages: mock(async () => {
        throw new Error('CDP lookup failed')
      }),
      closePage: mock(async () => {}),
      resolveTabIds: mock(async () => new Map<number, number>()),
    }
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: browser as never,
      registry: {} as never,
    })

    await service.processMessage(
      {
        target: BROWSEROS_TARGET,
        persist: false,
        conversationId: crypto.randomUUID(),
        message: 'Run the scheduled task',
        isScheduledTask: true,
        mode: 'agent',
        origin: 'sidepanel',
        browserContext: {
          activeTab: {
            id: 3,
            url: 'https://example.com',
            title: 'Example',
          },
        },
      } as never,
      new AbortController().signal,
    )

    const createArgs = createAgentSpy.mock.calls.at(-1)?.[0] as {
      browserContext?: {
        windowId?: number
        activeTab?: {
          id: number
          pageId: number
          url: string
          title: string
        }
      }
    }
    expect(createArgs.browserContext?.windowId).toBeUndefined()
    expect(createArgs.browserContext?.activeTab).toEqual({
      id: 88,
      pageId: 88,
      url: 'about:blank',
      title: 'Scheduled Task',
    })
    expect(browser.closePage).toHaveBeenCalledWith(88)
  })
})

describe('ChatService browser tool config', () => {
  it('passes fresh lease tokens into new and rebuilt agent sessions', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    let klavisStatus: KlavisProxyStatus = { state: 'connecting' }
    const browser = {
      resolveTabIds: mock(
        async (tabIds: number[]) =>
          new Map(tabIds.map((tabId) => [tabId, tabId + 100])),
      ),
      closePage: mock(async () => {}),
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub(() => klavisStatus) as never,
      browser: browser as never,
      browserSession: { pages: {} } as never,
    })
    const createCallsBefore = createAgentSpy.mock.calls.length
    const request = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId: crypto.randomUUID(),
      message: 'check integrations',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      browserContext: {
        activeTab: {
          id: 3,
          url: 'https://example.com',
          title: 'Example',
        },
        enabledMcpServers: ['slack'],
      },
    } as never

    await service.processMessage(request, new AbortController().signal)

    agentToReturn = secondAgent
    klavisStatus = { state: 'ready', toolCount: 0 }

    await service.processMessage(
      { ...request, message: 'check integrations again' },
      new AbortController().signal,
    )

    const createCalls = createAgentSpy.mock.calls.slice(createCallsBefore)
    expect(createCalls).toHaveLength(2)
    for (const [config] of createCalls) {
      expect(config).toMatchObject({
        serverPort: 32123,
        browserToolLeaseToken: expect.stringContaining('test-lease-'),
      })
      expect(config).not.toHaveProperty('browserSession')
    }
    const leaseTokens = createCalls.map(
      ([config]) =>
        (config as { browserToolLeaseToken: string }).browserToolLeaseToken,
    )
    expect(leaseTokens[0]).not.toBe(leaseTokens[1])
  })
})

describe('ChatService Klavis session rebuilds', () => {
  it('rebuilds a managed-app session when Klavis becomes ready', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    let lastPromptUiMessages: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      lastPromptUiMessages = uiMessages
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    let klavisStatus: KlavisProxyStatus = { state: 'connecting' }
    const browser = {
      resolveTabIds: mock(
        async (tabIds: number[]) =>
          new Map(tabIds.map((tabId) => [tabId, tabId + 100])),
      ),
      closePage: mock(async () => {}),
    }
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub(() => klavisStatus) as never,
      browser: browser as never,
      registry: {} as never,
    })
    const createCallsBefore = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()
    const request = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId,
      message: 'check integrations',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      browserContext: {
        activeTab: {
          id: 3,
          url: 'https://example.com',
          title: 'Example',
        },
        enabledMcpServers: ['slack'],
      },
    } as never

    await service.processMessage(request, new AbortController().signal)

    agentToReturn = secondAgent
    klavisStatus = { state: 'ready', toolCount: 0 }

    await service.processMessage(
      { ...request, message: 'check integrations again' },
      new AbortController().signal,
    )

    expect(createAgentSpy.mock.calls.length - createCallsBefore).toBe(2)
    expect(firstAgent.dispose).toHaveBeenCalledTimes(1)
    const firstCreateConfig = createAgentSpy.mock.calls[
      createCallsBefore
    ]?.[0] as { outputFileAccess?: unknown } | undefined
    const secondCreateConfig = createAgentSpy.mock.calls[
      createCallsBefore + 1
    ]?.[0] as { outputFileAccess?: unknown } | undefined
    expect(firstCreateConfig?.outputFileAccess).toBeDefined()
    expect(secondCreateConfig?.outputFileAccess).toBe(
      firstCreateConfig?.outputFileAccess,
    )

    expect(secondAgent.messages).toHaveLength(2)
    const persistedRebuiltMessage =
      secondAgent.messages[1]?.parts[0]?.text ?? ''
    expect(persistedRebuiltMessage).toBe('check integrations again')

    const promptRebuiltMessage =
      lastPromptUiMessages?.at(-1)?.parts[0]?.text ?? ''
    expect(promptRebuiltMessage).toContain(
      'Klavis app integration tools are now available for the following connected apps: slack.',
    )
    expect(promptRebuiltMessage).not.toContain('klavis:connecting')
    expect(promptRebuiltMessage).not.toContain('klavis:ready')
  })

  it('does not rebuild a session with no enabled managed apps when Klavis connects', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    let klavisStatus: KlavisProxyStatus = { state: 'connecting' }
    const browser = {
      resolveTabIds: mock(
        async (tabIds: number[]) =>
          new Map(tabIds.map((tabId) => [tabId, tabId + 200])),
      ),
      closePage: mock(async () => {}),
    }
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub(() => klavisStatus) as never,
      browser: browser as never,
      registry: {} as never,
    })
    const createCallsBefore = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()
    const request = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId,
      message: 'check browser only',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      browserContext: {
        activeTab: {
          id: 5,
          url: 'https://example.com',
          title: 'Example',
        },
      },
    } as never

    await service.processMessage(request, new AbortController().signal)

    agentToReturn = secondAgent
    klavisStatus = { state: 'ready', toolCount: 0 }

    await service.processMessage(
      { ...request, message: 'check browser only again' },
      new AbortController().signal,
    )

    expect(createAgentSpy.mock.calls.length - createCallsBefore).toBe(1)
    expect(firstAgent.dispose).not.toHaveBeenCalled()
    expect(firstAgent.messages).toHaveLength(2)
  })
})

describe('ChatService chat/agent mode switches', () => {
  // An agent's toolset and system prompt are frozen when the session is
  // built, so a mode change only takes effect if the session is rebuilt.

  // resolveLLMConfigSpy is module-scoped and shared with every other describe
  // in this file. Pin it per test rather than inheriting whatever the last one
  // happened to leave behind.
  beforeEach(() => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })

  function createModeSwitchService() {
    const browser = {
      resolveTabIds: mock(
        async (tabIds: number[]) =>
          new Map(tabIds.map((tabId) => [tabId, tabId + 100])),
      ),
      closePage: mock(async () => {}),
    }
    return new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: browser as never,
      registry: {} as never,
    })
  }

  function modeRequest(conversationId: string, mode: 'chat' | 'agent') {
    return {
      target: BROWSEROS_TARGET,
      conversationId,
      message: 'please open a new tab and go to github.com',
      isScheduledTask: false,
      mode,
      origin: 'newtab',
      // These cases are about rebuilding the tool set, not history. They used
      // to reach no database only because omitting the flag meant persisting
      // nothing, which stopped being the default when it became `persist`.
      persist: false,
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
      },
    } as never
  }

  it('rebuilds the session when the user switches from chat to agent', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    let lastPromptUiMessages: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      lastPromptUiMessages = uiMessages
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    const service = createModeSwitchService()
    const createCallsBefore = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()

    await service.processMessage(
      modeRequest(conversationId, 'chat'),
      new AbortController().signal,
    )

    agentToReturn = secondAgent

    await service.processMessage(
      modeRequest(conversationId, 'agent'),
      new AbortController().signal,
    )

    const createCalls = createAgentSpy.mock.calls.slice(createCallsBefore)
    expect(createCalls).toHaveLength(2)
    expect(firstAgent.dispose).toHaveBeenCalledTimes(1)

    const firstConfig = createCalls[0]?.[0] as {
      resolvedConfig?: { chatMode?: boolean }
    }
    const secondConfig = createCalls[1]?.[0] as {
      resolvedConfig?: { chatMode?: boolean }
    }
    expect(firstConfig?.resolvedConfig?.chatMode).toBe(true)
    expect(secondConfig?.resolvedConfig?.chatMode).toBe(false)

    const promptText = lastPromptUiMessages?.at(-1)?.parts[0]?.text ?? ''
    expect(promptText).toContain('The user switched to agent mode')
    expect(secondAgent.messages.at(-1)?.parts[0]?.text).toBe(
      'please open a new tab and go to github.com',
    )
  })

  it('re-restricts the session when switching back to chat mode', async () => {
    // The toggle has to enforce in both directions. Rebuilding only on
    // chat -> agent would leave chat -> agent -> chat holding full write tools
    // while the UI reads chat.
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    const thirdAgent = createFakeAgent()
    agentToReturn = firstAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    const service = createModeSwitchService()
    const createCallsBefore = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()

    await service.processMessage(
      modeRequest(conversationId, 'chat'),
      new AbortController().signal,
    )
    agentToReturn = secondAgent
    await service.processMessage(
      modeRequest(conversationId, 'agent'),
      new AbortController().signal,
    )
    agentToReturn = thirdAgent
    await service.processMessage(
      modeRequest(conversationId, 'chat'),
      new AbortController().signal,
    )

    const createCalls = createAgentSpy.mock.calls.slice(createCallsBefore)
    expect(createCalls).toHaveLength(3)
    const thirdConfig = createCalls[2]?.[0] as {
      resolvedConfig?: { chatMode?: boolean }
    }
    expect(thirdConfig?.resolvedConfig?.chatMode).toBe(true)
  })

  it('does not rebuild the session when the mode is unchanged', async () => {
    const firstAgent = createFakeAgent()
    agentToReturn = firstAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    const service = createModeSwitchService()
    const createCallsBefore = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()

    await service.processMessage(
      modeRequest(conversationId, 'agent'),
      new AbortController().signal,
    )
    await service.processMessage(
      modeRequest(conversationId, 'agent'),
      new AbortController().signal,
    )

    expect(createAgentSpy.mock.calls.length - createCallsBefore).toBe(1)
    expect(firstAgent.dispose).not.toHaveBeenCalled()
  })

  it('rebuilds the first heartbeat session when server history marks the next turn as a continuation', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    let heartbeatContinuation = false
    const leases: Array<{ readOnly: boolean }> = []
    const browserMcp = {
      createLease: mock((input: { readOnly?: boolean }) => {
        const lease = { readOnly: input.readOnly ?? false }
        leases.push(lease)
        return {
          token: `heartbeat-test-lease-${leases.length}`,
          updateBrowserContext: mock(() => {}),
          revoke: mock(() => {}),
        }
      }),
    }
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: { resolveTabIds: mock(async () => new Map()) } as never,
      browserMcp: browserMcp as never,
      heartbeatContinuationResolver: async () => heartbeatContinuation,
      serverPort: 32123,
    })
    const createCallsBefore = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()
    const request = {
      ...modeRequest(conversationId, 'agent'),
      isScheduledTask: true,
    }

    await service.processMessage(request, new AbortController().signal)
    heartbeatContinuation = true
    agentToReturn = secondAgent
    await service.processMessage(request, new AbortController().signal)

    const createCalls = createAgentSpy.mock.calls.slice(createCallsBefore)
    expect(createCalls).toHaveLength(2)
    expect(firstAgent.dispose).toHaveBeenCalledTimes(1)
    expect(leases.map((lease) => lease.readOnly)).toEqual([false, true])
    const firstAgentArgs = createCalls[0]?.[0] as
      | { resolvedConfig?: { heartbeatContinuation?: boolean } }
      | undefined
    const secondAgentArgs = createCalls[1]?.[0] as
      | { resolvedConfig?: { heartbeatContinuation?: boolean } }
      | undefined
    expect(firstAgentArgs?.resolvedConfig?.heartbeatContinuation).toBe(false)
    expect(secondAgentArgs?.resolvedConfig?.heartbeatContinuation).toBe(true)
  })
})

describe('ChatService single-rebuild reconciliation', () => {
  beforeEach(() => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })

  function makeService(getKlavis: () => KlavisProxyStatus) {
    const browser = {
      resolveTabIds: mock(
        async (tabIds: number[]) =>
          new Map(tabIds.map((tabId) => [tabId, tabId + 100])),
      ),
      closePage: mock(async () => {}),
    }
    return new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub(getKlavis) as never,
      browser: browser as never,
      registry: {} as never,
    })
  }

  function captureStreamPrompt() {
    const captured: { prompt?: MockMessage[] } = {}
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      captured.prompt = uiMessages
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }
    return captured
  }

  it('rebuilds once and emits both notices when MCP servers and mode change together', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    const captured = captureStreamPrompt()

    let klavis: KlavisProxyStatus = { state: 'connecting' }
    const service = makeService(() => klavis)
    const before = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()
    const base = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId,
      isScheduledTask: false,
      origin: 'newtab',
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
        enabledMcpServers: ['slack'],
      },
    }

    await service.processMessage(
      { ...base, message: 'hi', mode: 'chat' } as never,
      new AbortController().signal,
    )
    agentToReturn = secondAgent
    klavis = { state: 'ready', toolCount: 0 }
    await service.processMessage(
      { ...base, message: 'now act', mode: 'agent' } as never,
      new AbortController().signal,
    )

    expect(createAgentSpy.mock.calls.length - before).toBe(2)
    expect(firstAgent.dispose).toHaveBeenCalledTimes(1)

    const text = captured.prompt?.at(-1)?.parts[0]?.text ?? ''
    expect(text).toContain(
      'Klavis app integration tools are now available for the following connected apps: slack.',
    )
    expect(text).toContain('The user switched to agent mode')
  })

  it('rebuilds once and emits both notices when workspace and mode change together', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    const captured = captureStreamPrompt()

    const service = makeService(() => ({ state: 'stopped' }))
    const before = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()
    const base = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId,
      isScheduledTask: false,
      origin: 'newtab',
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
      },
    }

    await service.processMessage(
      { ...base, message: 'hi', mode: 'agent' } as never,
      new AbortController().signal,
    )
    agentToReturn = secondAgent
    await service.processMessage(
      {
        ...base,
        message: 'restrict me',
        mode: 'chat',
        userWorkingDir: '/ws',
      } as never,
      new AbortController().signal,
    )

    expect(createAgentSpy.mock.calls.length - before).toBe(2)
    expect(firstAgent.dispose).toHaveBeenCalledTimes(1)

    const text = captured.prompt?.at(-1)?.parts[0]?.text ?? ''
    expect(text).toContain(
      'The user connected a workspace during this conversation, but read-only chat mode',
    )
    expect(text).toContain('The user switched to read-only chat mode')
  })

  it('keeps the workspace notice when MCP servers also change in the same turn', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    const captured = captureStreamPrompt()

    let klavis: KlavisProxyStatus = { state: 'connecting' }
    const service = makeService(() => klavis)
    const before = createAgentSpy.mock.calls.length
    const conversationId = crypto.randomUUID()
    const base = {
      target: BROWSEROS_TARGET,
      persist: false,
      conversationId,
      isScheduledTask: false,
      origin: 'newtab',
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
        enabledMcpServers: ['slack'],
      },
    }

    await service.processMessage(
      { ...base, message: 'hi', mode: 'agent' } as never,
      new AbortController().signal,
    )
    agentToReturn = secondAgent
    klavis = { state: 'ready', toolCount: 0 }
    await service.processMessage(
      {
        ...base,
        message: 'connect a workspace',
        mode: 'agent',
        userWorkingDir: '/ws',
      } as never,
      new AbortController().signal,
    )

    expect(createAgentSpy.mock.calls.length - before).toBe(2)
    expect(firstAgent.dispose).toHaveBeenCalledTimes(1)

    const text = captured.prompt?.at(-1)?.parts[0]?.text ?? ''
    expect(text).toContain(
      'Klavis app integration tools are now available for the following connected apps: slack.',
    )
    expect(text).toContain(
      'The user connected a workspace during this conversation. Filesystem tools are now available. Working directory: /ws',
    )
  })
})

describe('ChatService history persistence', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    closeDb()
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  beforeEach(() => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })

  function persistenceBrowser() {
    return {
      resolveTabIds: mock(async () => new Map<number, number>()),
      closePage: mock(async () => {}),
    }
  }

  function browserOsRequest(conversationId: string, persist: boolean) {
    return {
      target: BROWSEROS_TARGET,
      conversationId,
      message: 'hello',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      persist,
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
      },
    } as never
  }

  it('omits provider error text from logs while preserving the stream error response', async () => {
    const sentinel = 'provider-private-body-sentinel-7f3d'
    const providerError = Object.assign(new Error(sentinel), {
      statusCode: 429,
    })
    const agent = createFakeAgent()
    agentToReturn = agent
    loggerErrorSpy.mockClear()
    streamResponseHandler = async ({ onError }) => {
      const errorText = onError?.(providerError) ?? ''
      return new Response(errorText)
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
    })

    const response = await service.processMessage(
      browserOsRequest(crypto.randomUUID(), false),
      new AbortController().signal,
    )
    const streamText = await response.text()

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1)
    const logged = loggerErrorSpy.mock.calls[0]
    expect(logged?.[1]).toMatchObject({ errorType: 'Error', statusCode: 429 })
    expect(JSON.stringify(logged)).not.toContain(sentinel)
    const firstDataLine = streamText
      .split('\n')
      .find((line) => line.startsWith('data: {'))
    if (!firstDataLine) throw new Error('Expected a streamed error chunk')
    const textChunk = JSON.parse(firstDataLine.slice('data: '.length)) as {
      delta: string
    }
    const errorEnvelope = JSON.parse(textChunk.delta) as {
      error: { code: string; message: string; details?: string }
    }
    expect(errorEnvelope.error.code).toBe('unknown')
    expect(errorEnvelope.error.message).toBe(sentinel)
  })

  it('forwards a server-held approval id and grants only its exact one-shot binding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-chat-approval-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })

    const approvalId = 'server-sdk-approval-42'
    const toolCallId = 'provider-tool-call-9'
    const toolName = 'filesystem_write'
    const input = { path: '/tmp/approval-regression.txt', content: 'approved' }
    const agent = createFakeAgent()
    agent.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName,
          toolCallId,
          input,
          state: 'approval-requested',
          approval: { id: approvalId },
        },
      ],
    } as never)
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? agent.messages })
      return new Response('ok')
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
    })

    await service.processMessage(
      {
        ...browserOsRequest(crypto.randomUUID(), false),
        message: '',
        approvalResponse: { id: approvalId, approved: true },
      } as never,
      new AbortController().signal,
    )

    const streamOptions = createAgentUIStreamSpy.mock.calls.at(-1)?.[0]
    expect(streamOptions?.options?.approvalId).toBe(approvalId)
    const taskId = streamOptions?.options?.taskId
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/)
    if (!taskId)
      throw new Error('Expected the approval stream to include its run id')

    const actionId = actionPolicyIdForCandidate({ toolName, input }) ?? toolName
    const binding = {
      taskId,
      approvalId,
      toolCallId,
      toolName,
      actionId,
      input,
    }
    expect(
      consumeApprovalOperation({
        ...binding,
        approvalId: 'client-substituted-id',
      }),
    ).toBe(false)
    expect(consumeApprovalOperation(binding)).toBe(true)
    expect(consumeApprovalOperation(binding)).toBe(false)
  })

  it('runs the production ChatService and ToolLoopAgent through approval, claim, dispatch, denial and replay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-chat-tool-loop-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
    })
    useProductionAgentFixture = true
    productionModelCalls = 0
    productionToolDispatches = []
    productionModelToolCallWasAborted = false

    const makeRequest = (
      conversationId: string,
      message: string,
      approvalResponse?: { id: string; approved: boolean },
    ) => ({
      ...browserOsRequest(conversationId, false),
      message,
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
        customMcpServers: [{ name: 'fixture', url: 'http://fixture.test/mcp' }],
      },
      ...(approvalResponse ? { approvalResponse } : {}),
    })
    const readOperationCounts = () => {
      const sqlite = getDbHandle().sqlite
      return {
        claims: (
          sqlite
            .prepare('SELECT COUNT(*) AS count FROM tool_operation_claims')
            .get() as { count: number }
        ).count,
        grants: (
          sqlite
            .prepare('SELECT COUNT(*) AS count FROM approval_operation_grants')
            .get() as { count: number }
        ).count,
        consumedGrants: (
          sqlite
            .prepare(
              'SELECT COUNT(*) AS count FROM approval_operation_grants WHERE consumed_at IS NOT NULL',
            )
            .get() as { count: number }
        ).count,
      }
    }

    try {
      const approvedConversation = crypto.randomUUID()
      await (
        await service.processMessage(
          makeRequest(approvedConversation, 'Send the message.') as never,
          new AbortController().signal,
        )
      ).text()
      const approvedMessages = (
        sessionStore.get(approvedConversation) as unknown as {
          agent: { messages: Array<{ parts: Array<Record<string, unknown>> }> }
        }
      ).agent.messages
      const approvedRequest = approvedMessages
        .flatMap((message) => message.parts)
        .find((part) => part.state === 'approval-requested')
      expect(approvedRequest?.toolCallId).toBe('provider-send-call-1')
      if (!approvedRequest) throw new Error('Expected a pending approval')
      expect(productionToolDispatches).toEqual([])

      const approvalId = (approvedRequest.approval as { id: string }).id
      await (
        await service.processMessage(
          makeRequest(approvedConversation, '', {
            id: approvalId,
            approved: true,
          }) as never,
          new AbortController().signal,
        )
      ).text()
      expect(productionToolDispatches).toEqual([
        { destination: 'user@example.test', body: 'hello' },
      ])
      expect(readOperationCounts()).toEqual({
        claims: 1,
        grants: 1,
        consumedGrants: 1,
      })

      const replay = await service.processMessage(
        makeRequest(approvedConversation, '', {
          id: approvalId,
          approved: true,
        }) as never,
        new AbortController().signal,
      )
      expect(replay.status).toBe(409)
      expect(productionToolDispatches).toHaveLength(1)
      expect(readOperationCounts()).toEqual({
        claims: 1,
        grants: 1,
        consumedGrants: 1,
      })

      const deniedConversation = crypto.randomUUID()
      await (
        await service.processMessage(
          makeRequest(deniedConversation, 'Send the message.') as never,
          new AbortController().signal,
        )
      ).text()
      const deniedMessages = (
        sessionStore.get(deniedConversation) as unknown as {
          agent: { messages: Array<{ parts: Array<Record<string, unknown>> }> }
        }
      ).agent.messages
      const deniedRequest = deniedMessages
        .flatMap((message) => message.parts)
        .find((part) => part.state === 'approval-requested')
      const deniedApprovalId = (
        deniedRequest?.approval as { id?: string } | undefined
      )?.id
      expect(deniedApprovalId).toBeTruthy()
      await (
        await service.processMessage(
          makeRequest(deniedConversation, '', {
            id: deniedApprovalId as string,
            approved: false,
          }) as never,
          new AbortController().signal,
        )
      ).text()
      expect(productionToolDispatches).toHaveLength(1)

      const deniedToolCallId = deniedRequest?.toolCallId
      expect(deniedToolCallId).toBeTruthy()
      expect(productionToolDispatches).toHaveLength(1)
      expect(
        (
          getDbHandle()
            .sqlite.prepare(
              'SELECT COUNT(*) AS count FROM tool_operation_claims',
            )
            .get() as { count: number }
        ).count,
      ).toBe(1)
      expect(readOperationCounts()).toEqual({
        claims: 1,
        grants: 1,
        consumedGrants: 1,
      })

      await (
        await service.processMessage(
          makeRequest(deniedConversation, 'Please try again.') as never,
          new AbortController().signal,
        )
      ).text()
      const retriedMessages = (
        sessionStore.get(deniedConversation) as unknown as {
          agent: { messages: Array<{ parts: Array<Record<string, unknown>> }> }
        }
      ).agent.messages
      const retriedRequest = retriedMessages
        .flatMap((message) => message.parts)
        .find((part) => part.state === 'approval-requested')
      if (!retriedRequest) throw new Error('Expected a fresh pending approval')
      expect(retriedRequest?.toolCallId).toBeTruthy()
      expect(retriedRequest?.toolCallId).not.toBe(deniedToolCallId)
      const retriedApprovalId = (retriedRequest.approval as { id: string }).id
      expect(retriedApprovalId).not.toBe(deniedApprovalId)
      expect(productionToolDispatches).toHaveLength(1)

      await (
        await service.processMessage(
          makeRequest(deniedConversation, '', {
            id: retriedApprovalId,
            approved: true,
          }) as never,
          new AbortController().signal,
        )
      ).text()
      expect(productionToolDispatches).toHaveLength(2)
      expect(readOperationCounts()).toEqual({
        claims: 2,
        grants: 2,
        consumedGrants: 2,
      })

      const retriedReplay = await service.processMessage(
        makeRequest(deniedConversation, '', {
          id: retriedApprovalId,
          approved: true,
        }) as never,
        new AbortController().signal,
      )
      expect(retriedReplay.status).toBe(409)
      expect(productionToolDispatches).toHaveLength(2)
      expect(readOperationCounts()).toEqual({
        claims: 2,
        grants: 2,
        consumedGrants: 2,
      })
    } finally {
      productionToolCallOverride = undefined
      useProductionAgentFixture = false
    }
  })

  it('blocks a concurrent duplicate approval at the active-run guard and dispatches once', async () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'browseros-chat-concurrent-approval-'),
    )
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
    })
    useProductionAgentFixture = true
    productionModelCalls = 0
    productionToolDispatches = []

    const conversationId = crypto.randomUUID()
    const makeRequest = (approvalResponse?: {
      id: string
      approved: boolean
    }) => ({
      ...browserOsRequest(conversationId, false),
      message: approvalResponse ? '' : 'Send the message.',
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
        customMcpServers: [{ name: 'fixture', url: 'http://fixture.test/mcp' }],
      },
      ...(approvalResponse ? { approvalResponse } : {}),
    })

    try {
      const initial = await service.processMessage(
        makeRequest() as never,
        new AbortController().signal,
      )
      await initial.text()
      const messages = (
        sessionStore.get(conversationId) as unknown as {
          agent: { messages: Array<{ parts: Array<Record<string, unknown>> }> }
        }
      ).agent.messages
      const pending = messages
        .flatMap((message) => message.parts)
        .find((part) => part.state === 'approval-requested')
      if (!pending) throw new Error('Expected a pending approval')
      const approvalId = (pending.approval as { id: string }).id
      expect(productionToolDispatches).toEqual([])

      const duplicateRequest = makeRequest({ id: approvalId, approved: true })
      const [first, duplicate] = await Promise.all([
        service.processMessage(
          duplicateRequest as never,
          new AbortController().signal,
        ),
        service.processMessage(
          duplicateRequest as never,
          new AbortController().signal,
        ),
      ])

      expect([first.status, duplicate.status].sort()).toEqual([200, 409])
      const accepted = first.status === 200 ? first : duplicate
      const rejected = first.status === 409 ? first : duplicate
      await accepted.text()
      expect(await rejected.json()).toEqual({
        error: 'An agent turn is already running',
      })

      expect(productionToolDispatches).toEqual([
        { destination: 'user@example.test', body: 'hello' },
      ])
      expect(await service.getRunSnapshot(conversationId)).toMatchObject({
        status: 'completed',
      })
      const counts = getDbHandle()
        .sqlite.prepare(`SELECT
          (SELECT COUNT(*) FROM tool_operation_claims) AS claims,
          (SELECT COUNT(*) FROM approval_operation_grants) AS grants,
          (SELECT COUNT(*) FROM approval_operation_grants WHERE consumed_at IS NOT NULL) AS consumed`)
        .get() as { claims: number; grants: number; consumed: number }
      expect(counts).toEqual({ claims: 1, grants: 1, consumed: 1 })
    } finally {
      productionToolCallOverride = undefined
      useProductionAgentFixture = false
    }
  })

  it('rechecks a changed deny policy before the production approval response can dispatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-chat-policy-recheck-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    const policyStore = new DbActionPolicyStore()
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
    })
    useProductionAgentFixture = true
    productionModelCalls = 0
    productionToolDispatches = []
    productionToolCallOverride = {
      toolName: 'tabs',
      input: {
        action: 'new',
        url: 'https://policy-race.example.test/',
        background: true,
      },
    }

    const conversationId = crypto.randomUUID()
    const makeRequest = (
      message: string,
      approvalResponse?: { id: string; approved: boolean },
    ) => ({
      ...browserOsRequest(conversationId, false),
      message,
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
        customMcpServers: [{ name: 'fixture', url: 'http://fixture.test/mcp' }],
      },
      ...(approvalResponse ? { approvalResponse } : {}),
    })

    try {
      const pendingResponse = await service.processMessage(
        makeRequest('Open a background tab.') as never,
        new AbortController().signal,
      )
      await pendingResponse.text()
      const messages = (
        sessionStore.get(conversationId) as unknown as {
          agent: { messages: Array<{ parts: Array<Record<string, unknown>> }> }
        }
      ).agent.messages
      const pending = messages
        .flatMap((message) => message.parts)
        .find((part) => part.state === 'approval-requested')
      if (!pending) throw new Error('Expected a pending tab approval')
      const approvalId = (pending.approval as { id: string }).id
      expect(productionToolDispatches).toEqual([])

      await policyStore.put('browser.tabs.new', {
        decision: 'deny',
        expiresAt: null,
      })
      const approvalResponse = await service.processMessage(
        makeRequest('', { id: approvalId, approved: true }) as never,
        new AbortController().signal,
      )
      await approvalResponse.text()

      expect(productionToolDispatches).toEqual([])
      const grantCount = getDbHandle()
        .sqlite.prepare(
          'SELECT COUNT(*) AS count FROM approval_operation_grants',
        )
        .get() as { count: number }
      expect(grantCount.count).toBe(0)
      const resolved = (
        sessionStore.get(conversationId) as unknown as {
          agent: { messages: Array<{ parts: Array<Record<string, unknown>> }> }
        }
      ).agent.messages
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            part.state === 'output-denied' &&
            (part.approval as { id?: string } | undefined)?.id === approvalId,
        )
      expect(resolved).toMatchObject({
        state: 'output-denied',
        approval: {
          id: approvalId,
          approved: false,
          reason: 'Blocked by the current saved action policy.',
        },
      })
    } finally {
      productionToolCallOverride = undefined
      useProductionAgentFixture = false
    }
  })

  it('stops a live production ToolLoopAgent before its saved-allow mutation dispatches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-chat-tool-loop-stop-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    const policyStore = new DbActionPolicyStore()
    await policyStore.put('browser.tabs.new', {
      decision: 'allow',
      expiresAt: null,
    })
    expect(await policyStore.getDecision('browser.tabs.new')).toBe('allow')
    const sessionStore = createSessionStore()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
    })
    useProductionAgentFixture = true
    productionModelCalls = 0
    productionToolDispatches = []
    productionModelToolCallWasAborted = false
    productionToolCallOverride = {
      toolName: 'tabs',
      input: {
        action: 'new',
        url: 'https://mutation.example.test/',
        background: true,
      },
    }

    const makeRequest = (conversationId: string) => ({
      ...browserOsRequest(conversationId, false),
      message: 'Open a background tab.',
      browserContext: {
        activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
        customMcpServers: [{ name: 'fixture', url: 'http://fixture.test/mcp' }],
      },
    })

    let releaseModel = () => {}
    try {
      const baselineConversationId = crypto.randomUUID()
      const baseline = await service.processMessage(
        makeRequest(baselineConversationId) as never,
        new AbortController().signal,
      )
      await baseline.text()
      expect(productionToolDispatches).toEqual([
        {
          action: 'new',
          url: 'https://mutation.example.test/',
          background: true,
        },
      ])

      productionModelCalls = 0
      productionToolDispatches = []

      const modelGate = new Promise<void>((resolve) => {
        releaseModel = resolve
      })
      let markModelStarted!: () => void
      const modelStarted = new Promise<void>((resolve) => {
        markModelStarted = resolve
      })
      let markToolCallProduced!: () => void
      const toolCallProduced = new Promise<void>((resolve) => {
        markToolCallProduced = resolve
      })
      productionModelGate = modelGate
      productionModelStarted = markModelStarted
      productionModelToolCallProduced = markToolCallProduced

      const conversationId = crypto.randomUUID()
      const response = await service.processMessage(
        makeRequest(conversationId) as never,
        new AbortController().signal,
      )
      const responseText = response.text()
      await modelStarted

      const runId = response.headers.get('x-browseros-run-id')
      expect(runId).toMatch(/^[0-9a-f-]{36}$/)
      expect(productionToolDispatches).toEqual([])
      expect(await service.stop(conversationId)).toBe(true)
      releaseModel()
      await toolCallProduced
      await responseText

      expect(productionModelToolCallWasAborted).toBe(true)
      const snapshot = await service.getRunSnapshot(conversationId)
      expect(snapshot?.status).toBe('aborted')
      expect(
        snapshot?.traceEvents?.map(({ taskId, kind, outcome }) => [
          taskId,
          kind,
          outcome,
        ]),
      ).toEqual([
        [runId, 'task_started', undefined],
        [runId, 'task_finished', 'aborted'],
      ])
      expect(productionModelCalls).toBe(1)
      expect(productionToolDispatches).toEqual([])
    } finally {
      releaseModel()
      productionToolCallOverride = undefined
      productionModelGate = undefined
      productionModelStarted = undefined
      productionModelToolCallProduced = undefined
      useProductionAgentFixture = false
    }
  })

  it('hydrates from and persists to the store in local mode', async () => {
    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish }) => {
      // A completed turn ends with the assistant reply.
      await onFinish({
        messages: [
          ...agent.messages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: 'hi there' }],
          },
        ],
      })
      return new Response('ok')
    }
    const conversationStore = {
      get: mock(async () => ({
        id: 'stored',
        messages: [
          {
            id: 'old',
            role: 'user',
            parts: [{ type: 'text', text: 'earlier' }],
          },
        ],
        targetType: 'browseros',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
      save: mock(async () => ({
        id: 'stored',
        targetType: 'browseros',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: conversationStore as never,
    })
    const conversationId = crypto.randomUUID()

    await service.processMessage(
      browserOsRequest(conversationId, true),
      new AbortController().signal,
    )

    expect(conversationStore.get).toHaveBeenCalledWith(conversationId)
    expect(agent.messages[0]?.parts[0]?.text).toBe('earlier')
    expect(conversationStore.save).toHaveBeenCalledTimes(1)
    const saved = conversationStore.save.mock.calls.at(-1)?.[0] as
      | { id: string; targetType: string }
      | undefined
    expect(saved?.id).toBe(conversationId)
    expect(saved?.targetType).toBe('browseros')
  })

  it('expires persisted approvals during hydration before a stale response can issue a grant', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-stale-approval-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })

    const conversationId = crypto.randomUUID()
    const approvalId = 'persisted-approval-before-restart'
    const storedMessages = [
      {
        id: 'assistant-pending-approval',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'filesystem_write',
            toolCallId: 'persisted-tool-call',
            input: { path: '/tmp/stale-approval.txt', content: 'unsafe' },
            state: 'approval-requested',
            approval: { id: approvalId },
          },
        ],
      },
    ]
    const conversationStore = {
      get: mock(async () => ({
        id: conversationId,
        messages: storedMessages,
        targetType: 'browseros',
        origin: 'sidepanel',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
      save: mock(async (input: unknown) => input),
    }
    const agent = createFakeAgent()
    agentToReturn = agent
    createAgentUIStreamSpy.mockClear()
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: conversationStore as never,
    })

    const response = await service.processMessage(
      {
        ...browserOsRequest(conversationId, true),
        message: '',
        approvalResponse: { id: approvalId, approved: true },
      } as never,
      new AbortController().signal,
    )

    expect(response.status).toBe(409)
    expect(createAgentUIStreamSpy).not.toHaveBeenCalled()
    const saved = conversationStore.save.mock.calls.at(-1)?.[0] as
      | { messages: Array<{ parts: Array<Record<string, unknown>> }> }
      | undefined
    const restoredApproval = saved?.messages
      .flatMap((message) => message.parts)
      .find((part) => part.approval !== undefined)
    expect(restoredApproval).toMatchObject({
      state: 'approval-responded',
      approval: {
        id: approvalId,
        approved: false,
        reason: expect.stringContaining('expired'),
      },
    })
    const grantCount = getDbHandle()
      .sqlite.prepare('SELECT COUNT(*) AS count FROM approval_operation_grants')
      .get() as { count: number }
    expect(grantCount.count).toBe(0)
  })

  it('does not persist and drops the dangling user message when a turn errors', async () => {
    const agent = createFakeAgent()
    agentToReturn = agent
    // The stream errored before any output: onFinish reports the history
    // ending on the user message, with no assistant reply appended.
    streamResponseHandler = async ({ onFinish }) => {
      await onFinish({ messages: agent.messages })
      return new Response('ok')
    }
    const conversationStore = {
      get: mock(async () => null),
      save: mock(async () => ({
        id: 'stored',
        targetType: 'browseros',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
    }
    const sessionStore = createSessionStore()
    const conversationId = crypto.randomUUID()
    const service = new ChatService({
      sessionStore: sessionStore as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: conversationStore as never,
    })

    await service.processMessage(
      browserOsRequest(conversationId, true),
      new AbortController().signal,
    )

    // The errored turn produced no assistant reply, so nothing is persisted:
    // a cold reload from SQLite stays clean. The in-memory session still holds
    // the unanswered user message; the guard is persistence, not a session trim.
    expect(conversationStore.save).not.toHaveBeenCalled()
    expect(sessionStore.get(conversationId)).toBeDefined()
  })

  it('never touches the store and seeds from previousConversation in cloud mode', async () => {
    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish }) => {
      await onFinish({ messages: agent.messages })
      return new Response('ok')
    }
    const conversationStore = {
      get: mock(async () => null),
      save: mock(async () => ({
        id: 'stored',
        targetType: 'browseros',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: conversationStore as never,
    })

    await service.processMessage(
      {
        ...browserOsRequest(crypto.randomUUID(), false),
        previousConversation: [{ role: 'user', content: 'from client' }],
      } as never,
      new AbortController().signal,
    )

    expect(conversationStore.get).not.toHaveBeenCalled()
    expect(conversationStore.save).not.toHaveBeenCalled()
    expect(agent.messages.some((m) => m.parts[0]?.text === 'from client')).toBe(
      true,
    )
  })

  it('ignores a stored record whose target is not browseros in local mode', async () => {
    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish }) => {
      await onFinish({ messages: agent.messages })
      return new Response('ok')
    }
    const conversationStore = {
      get: mock(async () => ({
        id: 'stored',
        messages: [
          {
            id: 'foreign',
            role: 'user',
            parts: [{ type: 'text', text: 'acp history' }],
          },
        ],
        targetType: 'claude',
        agentId: 'some-agent',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
      save: mock(async () => ({
        id: 'stored',
        targetType: 'browseros',
        lastMessagedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
    }
    const service = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: conversationStore as never,
    })

    await service.processMessage(
      browserOsRequest(crypto.randomUUID(), true),
      new AbortController().signal,
    )

    expect(
      agent.messages.every((m) => m.parts[0]?.text !== 'acp history'),
    ).toBe(true)
  })

  it('continues a persisted heartbeat after SQLite restart while ordinary scheduled tasks stay out of chat history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-heartbeat-chat-service-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'db', 'browseros.sqlite')
    const firstDb = initializeDb({ dbPath })
    const firstStore = new DbConversationStore({ db: firstDb.db })
    const heartbeatId = crypto.randomUUID()
    const firstAgent = createFakeAgent()
    agentToReturn = firstAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({
        messages: [
          ...(uiMessages ?? firstAgent.messages),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: 'heartbeat answer one' }],
          },
        ],
      })
      return new Response('ok')
    }

    const firstService = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: firstStore,
    })
    await firstService.processMessage(
      {
        ...browserOsRequest(heartbeatId, true),
        isScheduledTask: true,
        persistScheduledTask: true,
        message: 'heartbeat question one',
      } as never,
      new AbortController().signal,
    )
    expect(
      (await firstStore.get(heartbeatId))?.messages.map((m) => m.role),
    ).toEqual(['user', 'assistant'])

    closeDb()
    const reopenedDb = initializeDb({ dbPath })
    const reopenedStore = new DbConversationStore({ db: reopenedDb.db })
    const resumedAgent = createFakeAgent()
    agentToReturn = resumedAgent
    let resumedPrompt: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      resumedPrompt = uiMessages
      await onFinish({
        messages: [
          ...(uiMessages ?? resumedAgent.messages),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: 'heartbeat answer two' }],
          },
        ],
      })
      return new Response('ok')
    }
    const resumedService = new ChatService({
      sessionStore: createSessionStore(),
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: reopenedStore,
    })
    await resumedService.processMessage(
      {
        ...browserOsRequest(heartbeatId, true),
        isScheduledTask: true,
        persistScheduledTask: true,
        message: 'heartbeat question two',
      } as never,
      new AbortController().signal,
    )

    expect(resumedPrompt?.map((m) => m.parts[0]?.text)).toEqual([
      'heartbeat question one',
      'heartbeat answer one',
      expect.stringContaining('heartbeat question two'),
    ])
    expect(
      (await reopenedStore.get(heartbeatId))?.messages.map(
        (m) => m.parts[0]?.text,
      ),
    ).toEqual([
      'heartbeat question one',
      'heartbeat answer one',
      'heartbeat question two',
      'heartbeat answer two',
    ])

    const taskId = crypto.randomUUID()
    const taskAgent = createFakeAgent()
    agentToReturn = taskAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({
        messages: [
          ...(uiMessages ?? taskAgent.messages),
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: 'ordinary task answer' }],
          },
        ],
      })
      return new Response('ok')
    }
    const taskService = new ChatService({
      sessionStore: createSessionStore() as never,
      klavis: createKlavisStub() as never,
      browser: persistenceBrowser() as never,
      conversationStore: reopenedStore,
    })
    await taskService.processMessage(
      {
        ...browserOsRequest(taskId, true),
        isScheduledTask: true,
        message: 'ordinary scheduled task',
      } as never,
      new AbortController().signal,
    )
    expect(await reopenedStore.get(taskId)).toBeNull()
  })
})
