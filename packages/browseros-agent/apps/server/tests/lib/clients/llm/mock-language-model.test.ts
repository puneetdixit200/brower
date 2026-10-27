import { afterEach, describe, expect, it } from 'bun:test'
import { createMockLanguageModel } from '../../../../src/lib/clients/llm/mock-language-model'

const previous = process.env.BROWSEROS_MOCK_TOOL_CALL

afterEach(() => {
  if (previous === undefined) delete process.env.BROWSEROS_MOCK_TOOL_CALL
  else process.env.BROWSEROS_MOCK_TOOL_CALL = previous
})

describe('mock language model browser fixture', () => {
  it('emits one deterministic tabs.list tool call only when explicitly enabled', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'tabs.list'
    const model = createMockLanguageModel()
    const first = await model.doGenerate({ prompt: [] })
    const second = await model.doGenerate({ prompt: [] })

    expect(first.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tabs-list',
        toolName: 'tabs',
        input: JSON.stringify({ action: 'list' }),
      },
    ])
    expect(second.content).toEqual([
      { type: 'text', text: 'Mock BrowserOS test response.' },
    ])
  })
})
