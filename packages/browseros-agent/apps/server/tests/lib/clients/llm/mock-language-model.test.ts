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

  it('maps one selected Chrome tab to its MCP page for a multi-route sequence', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'a02.multi-page'
    const model = createMockLanguageModel()
    const calls = []
    const prompt = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text:
              '## Browser Context\n' +
              '**Selected Tabs (1):**\n' +
              '  1. Tab 120000 (Page ID: 12) - "Local page" (http://127.0.0.1:9191/one)\n' +
              '\n---\n\n<USER_QUERY>\n' +
              'Use the local fixture.\nA02_FIXTURE_TAB_ID=120000\n</USER_QUERY>',
          },
        ],
      },
    ]

    for (let index = 0; index < 8; index++) {
      const result = await model.doGenerate({ prompt })
      calls.push(result.content[0])
    }

    expect(calls).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call',
        toolName: 'snapshot',
        input: JSON.stringify({ page: 12 }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-2',
        toolName: 'act',
        input: JSON.stringify({
          page: 12,
          kind: 'fill',
          ref: 'e1',
          value: 'typed on page one',
          diff: 'none',
        }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-3',
        toolName: 'act',
        input: JSON.stringify({
          page: 12,
          kind: 'click',
          ref: 'e2',
          diff: 'none',
        }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-4',
        toolName: 'navigate',
        input: JSON.stringify({
          page: 12,
          action: 'url',
          url: 'http://127.0.0.1:9191/two',
        }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-5',
        toolName: 'snapshot',
        input: JSON.stringify({ page: 12 }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-6',
        toolName: 'act',
        input: JSON.stringify({
          page: 12,
          kind: 'fill',
          ref: 'e1',
          value: 'typed on page two',
          diff: 'none',
        }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-7',
        toolName: 'act',
        input: JSON.stringify({
          page: 12,
          kind: 'click',
          ref: 'e2',
          diff: 'none',
        }),
      },
      {
        type: 'tool-call',
        toolCallId: 'fixture-tool-call-8',
        toolName: 'navigate',
        input: JSON.stringify({
          page: 12,
          action: 'url',
          url: 'http://127.0.0.1:9191/done',
        }),
      },
    ])
  })

  it('does not execute a browser tool sequence for an unknown fixture name', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'unrecognized-fixture'
    const model = createMockLanguageModel()
    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([
      { type: 'text', text: 'Mock BrowserOS test response.' },
    ])
  })

  it('fails closed when the one-tab marker has no Browser Context mapping', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'a02.multi-page'
    const model = createMockLanguageModel()
    const result = await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'A02_FIXTURE_TAB_ID=120000\nBrowse two pages locally.',
            },
          ],
        },
      ],
    })

    expect(result.content).toEqual([
      { type: 'text', text: 'Mock BrowserOS test response.' },
    ])
  })

  it('fails closed when selected Browser Context maps the fixture tab more than once', async () => {
    process.env.BROWSEROS_MOCK_TOOL_CALL = 'a02.multi-page'
    const model = createMockLanguageModel()
    const result = await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                '## Browser Context\n' +
                '**Selected Tabs (2):**\n' +
                '  1. Tab 120000 (Page ID: 12) - "One"\n' +
                '  2. Tab 120000 (Page ID: 12) - "Duplicate"\n' +
                '\n---\n\n<USER_QUERY>\n' +
                'A02_FIXTURE_TAB_ID=120000\n</USER_QUERY>',
            },
          ],
        },
      ],
    })

    expect(result.content).toEqual([
      { type: 'text', text: 'Mock BrowserOS test response.' },
    ])
  })
})
