import { describe, expect, test } from 'bun:test'
import type { ResearchSupportResult } from '../../src/agent/research-support-assessment'
import {
  EVALUATION_CASES,
  evaluateResearchSupport,
  readLiveConfig,
} from './live-research-support-eval'

describe('live research support evaluation harness', () => {
  test('covers synthetic supporting, irrelevant, contradictory, and incomplete cases', () => {
    expect(EVALUATION_CASES.map(({ id }) => id)).toEqual([
      'supporting',
      'irrelevant',
      'contradictory',
      'incomplete',
    ])
  })

  test('reports labels and quote/source binding without returning assessment text', async () => {
    const summary = await evaluateResearchSupport(async ({ evidence }) => {
      const id = evidence[0].id
      const support =
        id === 'src_support'
          ? 'supported'
          : id === 'src_contradiction'
            ? 'unsupported'
            : 'unclear'
      const quote = evidence[0].excerpt
      return {
        status: 'completed',
        assessments: [
          {
            claim: 'private model claim content',
            support,
            explanation: 'private model explanation content',
            sourceIds: support === 'unclear' ? [] : [id],
            sources: [],
            quoteEvidence:
              support === 'unclear' ? [] : [{ sourceId: id, quote }],
          },
        ],
      } satisfies ResearchSupportResult
    })

    expect(summary.passed).toBe(4)
    expect(
      summary.cases.map(({ expected, returned }) => [expected, returned]),
    ).toEqual([
      ['supported', 'supported'],
      ['unclear', 'unclear'],
      ['unsupported', 'unsupported'],
      ['unclear', 'unclear'],
    ])
    expect(
      summary.cases.every((item) => item.boundQuoteCount === item.quoteCount),
    ).toBe(true)
    expect(summary.cases.every((item) => item.sourceIdsBound)).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('private model')
  })

  test('counts invented quotes as unbound and mismatched labels as failures', async () => {
    const summary = await evaluateResearchSupport(async ({ evidence }) => ({
      status: 'completed',
      assessments: [
        {
          claim: 'private text',
          support: 'supported',
          explanation: 'private text',
          sourceIds: ['invented_source'],
          sources: [],
          quoteEvidence: [
            { sourceId: evidence[0].id, quote: 'not in excerpt' },
          ],
        },
      ],
    }))

    expect(summary.passed).toBe(0)
    expect(summary.cases[0]).toMatchObject({
      returned: 'supported',
      matched: true,
      quoteCount: 1,
      boundQuoteCount: 0,
      sourceIdsBound: false,
    })
  })

  test('reads only dedicated direct-provider variables and rejects OAuth providers', () => {
    expect(
      readLiveConfig({
        T26_LIVE_PROVIDER: 'openai-compatible',
        T26_LIVE_MODEL: 'eval-model',
        T26_LIVE_BASE_URL: 'http://127.0.0.1:1234/v1',
        T26_LIVE_API_KEY: 'do-not-print-this',
        OPENAI_API_KEY: 'must-not-be-used',
      }),
    ).toEqual({
      provider: 'openai-compatible',
      model: 'eval-model',
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'do-not-print-this',
      resourceName: undefined,
    })
    expect(() =>
      readLiveConfig({
        T26_LIVE_PROVIDER: 'chatgpt-pro',
        T26_LIVE_MODEL: 'eval-model',
      }),
    ).toThrow('supported direct or compatible provider')
    expect(() =>
      readLiveConfig({
        T26_LIVE_PROVIDER: 'openai',
        T26_LIVE_MODEL: 'eval-model',
      }),
    ).toThrow('T26_LIVE_API_KEY')
  })
})
