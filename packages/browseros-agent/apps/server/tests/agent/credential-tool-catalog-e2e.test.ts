import { describe, expect, it, mock } from 'bun:test'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import type { ToolSet } from 'ai'
import { ToolLoopAgent } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import {
  buildAgentToolCatalog,
  excludeRawPageCodeTools,
} from '../../src/agent/credential-tool-filter'

const usage = {
  inputTokens: { total: 1, noCache: 1 },
  outputTokens: { total: 1, text: 1 },
}

const passwordSentinel = 'SAVED_PASSWORD_SENTINEL_DO_NOT_SEND'

describe('credential tool catalog model boundary', () => {
  it('keeps the credential tool and its result out of model requests', async () => {
    const credentialExecute = mock(async () => passwordSentinel)
    const rawPageCodeExecute = mock(async () => passwordSentinel)
    const safeExecute = mock(async () => 'Safe status result')
    const candidateTools: ToolSet = {
      read_saved_passwords: {
        description: 'Read all saved passwords from the browser vault.',
        inputSchema: z.object({}),
        execute: credentialExecute,
      },
      safe_status: {
        description: 'Read the current non-sensitive status.',
        inputSchema: z.object({}),
        execute: safeExecute,
      },
      run: {
        description: 'Run a safe page helper.',
        inputSchema: z.object({ code: z.string() }),
        execute: rawPageCodeExecute,
      },
      evaluate: {
        description: 'Evaluate a safe page expression.',
        inputSchema: z.object({ code: z.string() }),
        execute: rawPageCodeExecute,
      },
    }
    const restrictedInternal = excludeRawPageCodeTools(candidateTools)
    const catalog = buildAgentToolCatalog(restrictedInternal.allowed)
    const requests: unknown[] = []
    let modelCall = 0
    const model = new MockLanguageModelV3({
      doGenerate: async (request): Promise<LanguageModelV3GenerateResult> => {
        requests.push(request)
        modelCall++
        return {
          content:
            modelCall === 1
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: 'safe-status-call',
                    toolName: 'safe_status',
                    input: '{}',
                  },
                ]
              : [{ type: 'text', text: 'Status checked.' }],
          finishReason: {
            unified: modelCall === 1 ? 'tool-calls' : 'stop',
            raw: modelCall === 1 ? 'tool_calls' : 'stop',
          },
          usage,
          warnings: [],
        }
      },
    })
    const agent = new ToolLoopAgent({ model, tools: catalog.tools })

    await agent.generate({ prompt: 'Check the current status.' })

    expect(catalog.blocked.sort()).toEqual(['read_saved_passwords'].sort())
    expect(restrictedInternal.blocked.sort()).toEqual(['evaluate', 'run'])
    expect(Object.keys(catalog.tools)).toEqual(['safe_status'])
    expect(safeExecute).toHaveBeenCalledTimes(1)
    expect(credentialExecute).not.toHaveBeenCalled()
    expect(rawPageCodeExecute).not.toHaveBeenCalled()

    const modelInput = JSON.stringify(requests)
    expect(modelInput).toContain('safe_status')
    expect(modelInput).not.toContain('read_saved_passwords')
    expect(modelInput).not.toContain('run')
    expect(modelInput).not.toContain('evaluate')
    expect(modelInput).not.toContain(passwordSentinel)
  })
})
