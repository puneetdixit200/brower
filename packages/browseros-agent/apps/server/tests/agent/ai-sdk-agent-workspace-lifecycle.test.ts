import { afterEach, describe, expect, it, mock } from 'bun:test'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
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
