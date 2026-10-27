import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'
import type { LLMConfig } from '@browseros/shared/schemas/llm'
import { type LanguageModel, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { ResolvedLLMConfig } from './types'

const MOCK_MODEL_ID = 'browseros-test-mock'
export const MOCK_LLM_RESPONSE_TEXT = 'Mock BrowserOS test response.'

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

/** Fixed call sequences for isolated browser-tool smokes. */
function mockToolCalls(): { toolName: string; input: string }[] {
  switch (process.env.BROWSEROS_MOCK_TOOL_CALL) {
    case 'tabs.list':
      return [{ toolName: 'tabs', input: JSON.stringify({ action: 'list' }) }]
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
  const pendingToolCalls = mockToolCalls()
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
    doGenerate: async () => {
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
    doStream: async () => {
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
      return { stream: simulateReadableStream({ chunks }) }
    },
  }) as LanguageModel
}
