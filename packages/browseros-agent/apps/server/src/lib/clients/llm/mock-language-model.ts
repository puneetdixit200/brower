import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import type { LLMConfig } from '@browseros/shared/schemas/llm'
import { type LanguageModel, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { ResolvedLLMConfig } from './types'

const MOCK_MODEL_ID = 'browseros-test-mock'
export const MOCK_LLM_RESPONSE_TEXT = 'Mock BrowserOS test response.'

function mockStreamDelayMs(): number {
  const configured = Number(process.env.BROWSEROS_MOCK_STREAM_DELAY_MS)
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 30_000)
    : 0
}

function mockWaitDurationMs(): number {
  const configured = Number(process.env.BROWSEROS_MOCK_WAIT_MS)
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 30_000)
    : 20_000
}

const MOCK_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 4,
    text: 4,
    reasoning: undefined,
  },
}

function mockToolPageId(): number {
  const configured = Number(process.env.BROWSEROS_MOCK_TOOL_PAGE)
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 1
}

function a02FixturePageId(prompt: LanguageModelV3Prompt): number | null {
  const userText = prompt
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const markers = [...userText.matchAll(/^A02_FIXTURE_TAB_ID=([^\r\n]+)$/gm)]
  if (markers.length !== 1) return null

  const markerValue = markers[0]?.[1]
  if (!markerValue || !/^\d+$/.test(markerValue)) return null
  const chromeTabId = Number(markerValue)
  if (!Number.isSafeInteger(chromeTabId) || chromeTabId <= 0) return null

  const browserContextSections = [
    ...userText.matchAll(/^## Browser Context\r?\n([\s\S]*?)\r?\n\r?\n---/gm),
  ]
  if (browserContextSections.length !== 1) return null
  const context = browserContextSections[0]?.[1]
  if (!context) return null

  const selectedSections = [
    ...context.matchAll(
      /^\*\*Selected Tabs \(\d+\):\*\*\r?\n((?:[ \t]+\d+\. Tab .*\r?\n?)*)/gm,
    ),
  ]
  if (selectedSections.length !== 1) return null
  const selectedLines = selectedSections[0]?.[1] ?? ''
  const mappings = new Map<number, number[]>()
  for (const match of selectedLines.matchAll(
    /^\s+\d+\. Tab (\d+) \(Page ID: (\d+)\)(?:\s|$)/gm,
  )) {
    const chromeTabId = Number(match[1])
    const pageId = Number(match[2])
    if (
      !Number.isSafeInteger(chromeTabId) ||
      chromeTabId <= 0 ||
      !Number.isSafeInteger(pageId) ||
      pageId <= 0
    ) {
      return null
    }
    mappings.set(chromeTabId, [...(mappings.get(chromeTabId) ?? []), pageId])
  }

  const pageIds = mappings.get(chromeTabId) ?? []
  return pageIds.length === 1 ? (pageIds[0] ?? null) : null
}

/** Fixed call sequences for isolated browser-tool smokes. */
function mockToolCalls(
  prompt: LanguageModelV3Prompt,
): { toolName: string; input: string }[] {
  switch (process.env.BROWSEROS_MOCK_TOOL_CALL) {
    case 'tabs.list':
      return [{ toolName: 'tabs', input: JSON.stringify({ action: 'list' }) }]
    case 'wait':
      return [
        {
          toolName: 'wait',
          input: JSON.stringify({
            page: mockToolPageId(),
            for: 'time',
            value: mockWaitDurationMs(),
          }),
        },
      ]
    case 'act.click':
      return [mockClickCall()]
    case 'act.click-after-snapshot':
      return [
        {
          toolName: 'snapshot',
          input: JSON.stringify({ page: mockToolPageId() }),
        },
        mockClickCall(),
      ]
    case 'a02.multi-page': {
      const pageId = a02FixturePageId(prompt)
      if (!pageId) return []
      return [
        { toolName: 'snapshot', input: JSON.stringify({ page: pageId }) },
        mockActCall(pageId, 'fill', {
          ref: 'e1',
          value: 'typed on page one',
        }),
        mockActCall(pageId, 'click', { ref: 'e2' }),
        {
          toolName: 'navigate',
          input: JSON.stringify({
            page: pageId,
            action: 'url',
            url: 'http://127.0.0.1:9191/two',
          }),
        },
        { toolName: 'snapshot', input: JSON.stringify({ page: pageId }) },
        mockActCall(pageId, 'fill', {
          ref: 'e1',
          value: 'typed on page two',
        }),
        mockActCall(pageId, 'click', { ref: 'e2' }),
        {
          toolName: 'navigate',
          input: JSON.stringify({
            page: pageId,
            action: 'url',
            url: 'http://127.0.0.1:9191/done',
          }),
        },
      ]
    }
    default:
      return []
  }
}

function mockClickCall() {
  return {
    toolName: 'act',
    input: JSON.stringify({
      page: mockToolPageId(),
      kind: 'click',
      ref: 'e1',
      diff: 'none',
    }),
  }
}

function mockActCall(
  page: number,
  kind: 'fill' | 'click',
  args: { ref: string; value?: string },
) {
  return {
    toolName: 'act',
    input: JSON.stringify({ page, kind, ...args, diff: 'none' }),
  }
}

function createMockResult(): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text: MOCK_LLM_RESPONSE_TEXT }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: MOCK_USAGE,
    warnings: [],
  }
}

/**
 * Whether the test harness has asked for a canned model.
 *
 * Deliberately not keyed on a provider. It used to fire only for the hosted
 * BrowserOS provider, which made every end-to-end chat test depend on that
 * provider existing. The switch belongs to the harness, not to any one
 * provider, and it is only ever read from the environment the harness sets.
 */
export function shouldUseMockLLM(): boolean {
  return process.env.BROWSEROS_USE_MOCK_LLM === 'true'
}

/**
 * Stands in for credential resolution while the harness is on, so a test does
 * not need a key, a gateway or a reachable provider to exercise the chat path.
 */
export function resolveMockLLMConfig(config: LLMConfig): ResolvedLLMConfig {
  return {
    ...config,
    model: config.model ?? MOCK_MODEL_ID,
  }
}

export function createMockLanguageModel(): LanguageModel {
  let pendingToolCalls: { toolName: string; input: string }[] | undefined
  let toolCallId = 0
  const chunks: LanguageModelV3StreamPart[] = [
    { type: 'text-start', id: 'text-1' },
    {
      type: 'text-delta',
      id: 'text-1',
      delta: MOCK_LLM_RESPONSE_TEXT,
    },
    { type: 'text-end', id: 'text-1' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: MOCK_USAGE,
    },
  ]

  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      pendingToolCalls ??= mockToolCalls(prompt)
      const call = pendingToolCalls.shift()
      if (!call) return createMockResult()
      toolCallId++
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId:
              toolCallId === 1
                ? 'fixture-tool-call'
                : `fixture-tool-call-${toolCallId}`,
            ...call,
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: MOCK_USAGE,
        warnings: [],
      }
    },
    doStream: async ({ prompt }) => {
      pendingToolCalls ??= mockToolCalls(prompt)
      const call = pendingToolCalls.shift()
      if (call) {
        toolCallId++
        const toolChunks: LanguageModelV3StreamPart[] = [
          {
            type: 'tool-call',
            toolCallId:
              toolCallId === 1
                ? 'fixture-tool-call'
                : `fixture-tool-call-${toolCallId}`,
            ...call,
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage: MOCK_USAGE,
          },
        ]
        return { stream: simulateReadableStream({ chunks: toolChunks }) }
      }
      return {
        stream: simulateReadableStream({
          chunks,
          ...(mockStreamDelayMs() > 0 && {
            chunkDelayInMs: mockStreamDelayMs(),
          }),
        }),
      }
    },
  }) as LanguageModel
}
