import { afterEach, describe, expect, it } from 'bun:test'
import { createMockLanguageModel } from '../../../../src/lib/clients/llm/mock-language-model'

const previous = process.env.BROWSEROS_MOCK_TOOL_CALL
const previousPage = process.env.BROWSEROS_MOCK_TOOL_PAGE
const previousDelay = process.env.BROWSEROS_MOCK_STREAM_DELAY_MS
const previousWait = process.env.BROWSEROS_MOCK_WAIT_MS

afterEach(() => {
  if (previous === undefined) delete process.env.BROWSEROS_MOCK_TOOL_CALL
  else process.env.BROWSEROS_MOCK_TOOL_CALL = previous
  if (previousPage === undefined) delete process.env.BROWSEROS_MOCK_TOOL_PAGE
  else process.env.BROWSEROS_MOCK_TOOL_PAGE = previousPage
  if (previousDelay === undefined)
    delete process.env.BROWSEROS_MOCK_STREAM_DELAY_MS
  else process.env.BROWSEROS_MOCK_STREAM_DELAY_MS = previousDelay
  if (previousWait === undefined) delete process.env.BROWSEROS_MOCK_WAIT_MS
  else process.env.BROWSEROS_MOCK_WAIT_MS = previousWait
})

describe('mock language model browser fixture', () => {
  it('delays only the deterministic mock response when explicitly configured', async () => {
    process.env.BROWSEROS_MOCK_STREAM_DELAY_MS = '25'
    const model = createMockLanguageModel()
    const result = await model.doStream({ prompt: [] })
    const reader = result.stream.getReader()
    const first = await reader.read()
    const startedDelayAt = Date.now()
    const second = await reader.read()

    expect(first.done).toBe(false)
    expect(second.done).toBe(false)
    expect(Date.now() - startedDelayAt).toBeGreaterThanOrEqual(15)
    await reader.cancel()
  })

  it('emits one deterministic tabs.list tool call only when explicitly enabled', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'tabs.list'
    const model = createMockLanguageModel()
    const first = await model.doGenerate({ prompt: [] })
    const second = await model.doGenerate({ prompt: [] })

    expect(first.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call',
        toolName: 'tabs',
        input: JSON.stringify({ action: 'list' }),
      },
    ])
    expect(second.content).toEqual([
      { type: 'text', text: 'Mock BrowserOS test response.' },
    ])
  })

  it('offers the fixed act.click call for approval boundary fixtures', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'act.click'
    const model = createMockLanguageModel()
    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call',
        toolName: 'act',
        input: JSON.stringify({
          page: 1,
          kind: 'click',
          ref: 'e1',
          diff: 'none',
        }),
      },
    ])
  })

  it('offers a bounded abortable wait tool only as an explicit fixture', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'wait'
    process.env.BROWSEROS_MOCK_WAIT_MS = '20000'
    const model = createMockLanguageModel()
    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call',
        toolName: 'wait',
        input: JSON.stringify({ page: 1, for: 'time', value: 20000 }),
      },
    ])
  })

  it('allows the headed approval fixture to target its disposable test page', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'act.click'
    process.env.BROWSEROS_MOCK_TOOL_PAGE = '2'
    const model = createMockLanguageModel()
    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call',
        toolName: 'act',
        input: JSON.stringify({
          page: 2,
          kind: 'click',
          ref: 'e1',
          diff: 'none',
        }),
      },
    ])
  })

  it('snapshots before the headed approval fixture clicks a referenced element', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'act.click-after-snapshot'
    process.env.BROWSEROS_MOCK_TOOL_PAGE = '2'
    const model = createMockLanguageModel()

    const snapshot = await model.doGenerate({ prompt: [] })
    expect(snapshot.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call',
        toolName: 'snapshot',
        input: JSON.stringify({ page: 2 }),
      },
    ])

    const click = await model.doGenerate({ prompt: [] })
    expect(click.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-2',
        toolName: 'act',
        input: JSON.stringify({
          page: 2,
          kind: 'click',
          ref: 'e1',
          diff: 'none',
        }),
      },
    ])
  })
})
