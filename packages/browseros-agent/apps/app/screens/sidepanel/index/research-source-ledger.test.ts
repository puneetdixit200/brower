import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  getResearchSourceLedger,
  RESEARCH_LEDGER_LIMITATION,
} from './research-source-ledger'

function message(
  id: string,
  role: 'user' | 'assistant',
  text = '',
  extraParts: unknown[] = [],
): UIMessage {
  return {
    id,
    role,
    parts: [...(text ? [{ type: 'text', text }] : []), ...extraParts],
  } as unknown as UIMessage
}

function tool(name: string, state: string, output: unknown): unknown {
  return {
    type: `tool-${name}`,
    toolCallId: `${name}-1`,
    state,
    input: {},
    output,
  }
}

function readOutput(
  url: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      page: 1,
      format: 'markdown',
      url,
      contentLength: text.length,
      writtenToFile: false,
    },
    ...extra,
  }
}

const researchRequest = [
  'Research request (Aster, explicit user initiation):',
  'Compare the sources.',
  '',
  'User-attached seed sources (not automatically verified):',
  'https://seed.example/article?private=value',
  'Sensitive-path filtering is heuristic and cannot guarantee that every',
].join('\n')

describe('research source URL ledger', () => {
  it('classifies citations from successful read and navigate structured output', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool('read', 'output-available', {
            structuredContent: {
              page: 1,
              format: 'markdown',
              url: 'https://visited.example/article#top',
              contentLength: 12,
              writtenToFile: false,
            },
          }),
          tool('navigate', 'output-available', {
            structuredContent: { page: 2, url: 'https://nav.example/page' },
          }),
        ]),
        message(
          'answer',
          'assistant',
          'Read [article](https://visited.example/article) and https://nav.example/page.',
        ),
      ],
      false,
    )

    expect(ledger?.answerMessageId).toBe('answer')
    expect(ledger?.entries.map(({ status }) => status)).toEqual([
      'visited',
      'visited',
      'seed-only',
    ])
    expect(ledger?.entries.map(({ observedBy }) => observedBy)).toEqual([
      ['read'],
      ['navigate'],
      [],
    ])
  })

  it('lists both successful built-in tools only for exact normalized URL matches', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool('read', 'output-available', {
            structuredContent: {
              page: 1,
              format: 'markdown',
              url: 'https://both.example/article#read',
              contentLength: 12,
              writtenToFile: false,
            },
          }),
          tool('navigate', 'output-available', {
            structuredContent: {
              page: 2,
              url: 'https://both.example/article#navigate',
            },
          }),
        ]),
        message(
          'answer',
          'assistant',
          'https://both.example/article https://both.example/article?edition=2 https://unobserved.example/',
        ),
      ],
      false,
    )

    expect(
      ledger?.entries.map(({ status, observedBy }) => ({ status, observedBy })),
    ).toEqual([
      { status: 'visited', observedBy: ['read', 'navigate'] },
      { status: 'unverified', observedBy: [] },
      { status: 'unverified', observedBy: [] },
      { status: 'seed-only', observedBy: [] },
    ])
  })

  it('ignores errors, denials, tabs outputs, model text, and custom tools', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', 'I visited https://model.example/', [
          tool('read', 'output-error', {
            structuredContent: { url: 'https://failed.example/' },
          }),
          tool('navigate', 'output-available', {
            isError: true,
            structuredContent: { url: 'https://failed.example/' },
          }),
          tool('tabs', 'output-available', {
            structuredContent: { pages: [{ url: 'https://tabs.example/' }] },
          }),
          tool('custom_read', 'output-available', {
            structuredContent: { url: 'https://custom.example/' },
          }),
          tool('read', 'output-available', {
            structuredContent: { url: 'https://spoof.example/' },
          }),
        ]),
        message(
          'answer',
          'assistant',
          'https://model.example/ https://failed.example/ https://tabs.example/ https://custom.example/ https://spoof.example/',
        ),
      ],
      false,
    )

    expect(ledger?.entries.map(({ status }) => status)).toEqual([
      'unverified',
      'unverified',
      'unverified',
      'unverified',
      'unverified',
      'seed-only',
    ])
    expect(
      ledger?.entries.every(({ observedBy }) => observedBy.length === 0),
    ).toBe(true)
  })

  it('does not derive entries from other turns or show while the research turn streams', () => {
    const messages = [
      message('request', 'user', researchRequest),
      message('answer', 'assistant', 'https://answer.example/'),
      message('next-user', 'user', 'A different question'),
      message('later', 'assistant', 'https://later.example/', [
        tool('read', 'output-available', {
          structuredContent: {
            page: 1,
            format: 'markdown',
            url: 'https://later.example/',
            contentLength: 12,
            writtenToFile: false,
          },
        }),
      ]),
    ]

    const ledger = getResearchSourceLedger(messages, false)
    expect(ledger?.answerMessageId).toBe('answer')
    expect(ledger?.entries.map(({ status }) => status)).toEqual([
      'unverified',
      'seed-only',
    ])
    expect(getResearchSourceLedger(messages.slice(0, 2), true)).toBeNull()
    expect(
      getResearchSourceLedger([message('user', 'user', 'not research')], false),
    ).toBeNull()
  })

  it('does not match a query-bearing citation to a sanitized seed URL', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool('read', 'output-available', {
            structuredContent: {
              page: 1,
              format: 'text',
              url: 'https://seed.example/article?edition=2',
              contentLength: 12,
              writtenToFile: false,
            },
          }),
        ]),
        message(
          'answer',
          'assistant',
          'https://seed.example/article?edition=1',
        ),
      ],
      false,
    )

    expect(ledger?.entries[0]).toMatchObject({
      status: 'unverified',
      displayUrl: 'https://seed.example/article',
      observedBy: [],
    })
  })

  it('uses explicit wording that URL matching does not prove factual support', () => {
    expect(RESEARCH_LEDGER_LIMITATION).toContain('exact string match')
    expect(RESEARCH_LEDGER_LIMITATION).toContain(
      'do not prove claim support or truth',
    )
  })

  it('marks an adjacent quote found only when its exact text occurs in a same-URL successful read', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool(
            'read',
            'output-available',
            readOutput(
              'https://visited.example/article',
              'Page says: The study enrolled 120 patients.',
            ),
          ),
        ]),
        message(
          'answer',
          'assistant',
          'The study had 120 patients. “The study enrolled 120 patients.” [source](https://visited.example/article)',
        ),
      ],
      false,
    )

    expect(ledger?.entries[0]).toMatchObject({
      status: 'visited',
      quoteChecks: [{ quote: 'The study enrolled 120 patients.', found: true }],
    })
  })

  it('does not accept text from another URL or a fabricated quote', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool(
            'read',
            'output-available',
            readOutput(
              'https://other.example/article',
              'An exact sentence that was read.',
            ),
          ),
          tool(
            'read',
            'output-available',
            readOutput(
              'https://visited.example/article',
              'The page contains no matching wording.',
            ),
          ),
        ]),
        message(
          'answer',
          'assistant',
          '“An exact sentence that was read.” https://visited.example/article “A fabricated passage.” https://visited.example/article',
        ),
      ],
      false,
    )

    expect(
      ledger?.entries
        .find(({ url }) => url === 'https://visited.example/article')
        ?.quoteChecks.map(({ quote, found }) => ({ quote, found })),
    ).toEqual([
      { quote: 'An exact sentence that was read.', found: false },
      { quote: 'A fabricated passage.', found: false },
    ])
  })

  it('ignores failed and custom tool text as quote evidence', () => {
    const ledger = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool(
            'read',
            'output-error',
            readOutput('https://source.example/article', 'Exact quote.'),
          ),
          tool(
            'custom_read',
            'output-available',
            readOutput('https://source.example/article', 'Exact quote.'),
          ),
        ]),
        message(
          'answer',
          'assistant',
          '“Exact quote.” https://source.example/article',
        ),
      ],
      false,
    )

    expect(ledger?.entries[0]).toMatchObject({
      status: 'unverified',
      observedBy: [],
      quoteChecks: [{ quote: 'Exact quote.', found: false }],
    })
  })

  it('isolates quote evidence to this research turn and caps quote/output scans', () => {
    const sourceUrl = 'https://source.example/article'
    const manyQuotes = Array.from(
      { length: 13 },
      (_, index) => `“Quote ${index}.” ${sourceUrl}`,
    ).join(' ')
    const messages = [
      message('request', 'user', researchRequest),
      message('answer', 'assistant', manyQuotes),
      message('next-user', 'user', 'A different question'),
      message('later', 'assistant', '', [
        tool(
          'read',
          'output-available',
          readOutput(sourceUrl, `${'x'.repeat(100_000)} Quote 0.`),
        ),
      ]),
    ]

    const isolated = getResearchSourceLedger(messages, false)
    expect(isolated?.entries[0].quoteChecks).toHaveLength(12)
    expect(isolated?.entries[0].quoteChecks[0].found).toBe(false)

    const longQuote = `“${'x'.repeat(241)}” ${sourceUrl}`
    const bounded = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool(
            'read',
            'output-available',
            readOutput(sourceUrl, `${'x'.repeat(100_000)} ${'x'.repeat(241)}`),
          ),
        ]),
        message('answer', 'assistant', longQuote),
      ],
      false,
    )
    expect(bounded?.entries[0].quoteChecks).toEqual([])

    const beyondOutputLimit = getResearchSourceLedger(
      [
        message('request', 'user', researchRequest),
        message('tools', 'assistant', '', [
          tool(
            'read',
            'output-available',
            readOutput(
              sourceUrl,
              `${'x'.repeat(100_000)} Exact quote beyond output scan.`,
            ),
          ),
        ]),
        message(
          'answer',
          'assistant',
          `“Exact quote beyond output scan.” ${sourceUrl}`,
        ),
      ],
      false,
    )
    expect(beyondOutputLimit?.entries[0].quoteChecks).toMatchObject([
      { quote: 'Exact quote beyond output scan.', found: false },
    ])
  })
})
