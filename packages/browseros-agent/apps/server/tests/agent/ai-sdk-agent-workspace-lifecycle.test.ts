import { afterEach, describe, expect, it, mock } from 'bun:test'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { z } from 'zod'
import * as mcpBuilder from '../../src/agent/mcp-builder'
import * as prompt from '../../src/agent/prompt'
import * as providerFactory from '../../src/agent/provider-factory'
import type { ResolvedAgentConfig } from '../../src/agent/types'

let failPrompt = false
const realBuildSystemPrompt = prompt.buildSystemPrompt
const createMcpClients = mock(async () => ({ clients: [], tools: {} }))
mock.module('../../src/agent/provider-factory', () => ({
  ...providerFactory,
  createLanguageModel: mock(async () => ({ model: {} })),
}))
mock.module('../../src/agent/mcp-builder', () => ({
  ...mcpBuilder,
  buildInternalBrowserMcpSpec: mock(() => ({})),
  buildMcpServerSpecs: mock(async () => []),
  createMcpClients,
}))
mock.module('../../src/agent/prompt', () => ({
  ...prompt,
  buildSystemPrompt: mock(
    (...args: Parameters<typeof prompt.buildSystemPrompt>) => {
      if (failPrompt) throw new Error('prompt construction failed')
      return realBuildSystemPrompt(...args)
    },
  ),
}))

const { AiSdkAgent } = await import('../../src/agent/ai-sdk-agent')

function resolvedConfig(): ResolvedAgentConfig {
  return {
    conversationId: 'workspace-lifecycle-test',
    provider: LLM_PROVIDERS.OPENAI,
    model: 'test-model',
    workingDir: '/tmp/workspace-lifecycle-test',
  }
}

function trackedPin() {
  const close = mock(async () => {})
  return {
    close,
    pinWorkspaceRoot: mock(async (path: string) => ({
      path,
      handle: {} as never,
      run: async <T>(fn: () => Promise<T>) => fn(),
      close,
    })),
  }
}

afterEach(() => {
  failPrompt = false
  createMcpClients.mockReset()
  createMcpClients.mockImplementation(async () => ({ clients: [], tools: {} }))
})

describe('AiSdkAgent workspace pin lifecycle', () => {
  it('validates tool envelopes with per-run identity without retaining it on the agent', async () => {
    const dispatched: Array<{ input: unknown; context: unknown }> = []
    const execute = mock(
      async (input: unknown, options: { context?: unknown }) => {
        dispatched.push({ input, context: options.context })
        return { exact: input }
      },
    )
    const probeTool = {
      inputSchema: z.object({ value: z.string() }),
      execute,
    }
    createMcpClients.mockImplementation(async () => ({
      clients: [],
      tools: {
        envelope_probe: probeTool,
        'unsafe tool name': probeTool,
      } as never,
    }))
    const agent = await AiSdkAgent.create({
      resolvedConfig: { ...resolvedConfig(), chatMode: true },
      serverPort: 1,
      browserToolLeaseToken: 'test-token',
    })
    const tool = agent.toolLoopAgent.tools.envelope_probe
    if (!tool?.execute) throw new Error('Envelope probe was not registered')
    const malformedNameTool = agent.toolLoopAgent.tools['unsafe tool name']
    if (!malformedNameTool?.execute)
      throw new Error('Malformed-name probe was not registered')
    const firstTaskId = crypto.randomUUID()
    const secondTaskId = crypto.randomUUID()
    const firstInput = { value: 'first' }
    const secondInput = { value: 'second' }

    await expect(
      tool.execute(firstInput, {
        toolCallId: 'provider.secret.id',
        context: { taskId: firstTaskId },
      }),
    ).resolves.toEqual({ exact: firstInput })
    await expect(
      tool.execute(secondInput, {
        toolCallId: 'provider.other.id',
        context: { taskId: secondTaskId },
      }),
    ).resolves.toEqual({ exact: secondInput })
    await expect(
      tool.execute(
        { value: 'must not dispatch' },
        {
          toolCallId: 'provider.invalid.id',
          context: { taskId: 'not-a-uuid' },
        },
      ),
    ).rejects.toThrow()
    await expect(
      malformedNameTool.execute(
        { value: 'must not dispatch' },
        {
          toolCallId: 'provider.invalid.name',
          context: { taskId: firstTaskId },
        },
      ),
    ).rejects.toThrow()

    expect(dispatched).toEqual([
      { input: firstInput, context: undefined },
      { input: secondInput, context: undefined },
    ])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(agent.getToolRunContexts(firstTaskId).envelope_probe).toEqual({
      taskId: firstTaskId,
    })
    expect(agent.getToolRunContexts(secondTaskId).envelope_probe).toEqual({
      taskId: secondTaskId,
    })
    await agent.dispose()
  })

  it('closes its pinned workspace when disposed', async () => {
    const pin = trackedPin()
    const agent = await AiSdkAgent.create({
      resolvedConfig: resolvedConfig(),
      serverPort: 1,
      browserToolLeaseToken: 'test-token',
      pinWorkspaceRoot: pin.pinWorkspaceRoot,
    })

    await agent.dispose()

    expect(pin.pinWorkspaceRoot).toHaveBeenCalledTimes(1)
    expect(pin.close).toHaveBeenCalledTimes(1)
  })

  it('closes its pinned workspace when creation fails after pinning', async () => {
    const pin = trackedPin()
    failPrompt = true

    await expect(
      AiSdkAgent.create({
        resolvedConfig: resolvedConfig(),
        serverPort: 1,
        browserToolLeaseToken: 'test-token',
        pinWorkspaceRoot: pin.pinWorkspaceRoot,
      }),
    ).rejects.toThrow('prompt construction failed')

    expect(pin.pinWorkspaceRoot).toHaveBeenCalledTimes(1)
    expect(pin.close).toHaveBeenCalledTimes(1)
  })
})
