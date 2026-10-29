import { describe, expect, it } from 'bun:test'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV3 } from 'ai/test'
import { assessResearchSupport } from '../../src/agent/research-support-assessment'

/**
 * Small, deterministic relationship fixture set for the assessment pipeline.
 * The adjudications model a competent evaluator's expected response for each
 * controlled relationship; MockLanguageModelV3 keeps the suite offline and
 * repeatable. These cases exercise production parsing, quote/source binding,
 * filtering and support downgrades. They do not measure a real model's ability
 * to make the initial semantic judgment.
 */
const cases = [
  {
    name: 'supporting source',
    answer: 'The Kestrel bridge opened in 2018.',
    excerpt: 'The Kestrel bridge opened in 2018 after three years of work.',
    judgment: 'supported',
    explanation: 'The excerpt states the same opening year.',
    quote: 'The Kestrel bridge opened in 2018',
  },
  {
    name: 'irrelevant source',
    answer: 'The Kestrel bridge opened in 2018.',
    excerpt: 'The Kestrel bridge is painted green and crosses the Rill River.',
    judgment: 'unclear',
    explanation: 'The excerpt gives no opening date.',
  },
  {
    name: 'contradictory source',
    answer: 'The Kestrel bridge opened in 2018.',
    excerpt:
      'The Kestrel bridge opened in 2021, according to the city archive.',
    judgment: 'unsupported',
    explanation: 'The excerpt gives a different opening year.',
    quote: 'The Kestrel bridge opened in 2021',
  },
  {
    name: 'incomplete source',
    answer: 'The Kestrel bridge opened in 2018 after three years of work.',
    excerpt: 'The Kestrel bridge opened in 2018.',
    judgment: 'mixed',
    explanation:
      'The opening year is stated, but the construction duration is absent.',
    quote: 'The Kestrel bridge opened in 2018',
  },
] as const

describe('research support evidence-pipeline fixtures', () => {
  it('preserves supplied judgments across supporting, irrelevant, contradictory, and incomplete sources', async () => {
    const results = await Promise.all(
      cases.map(async (fixture, index) => {
        const sourceId = `src_eval_${index + 1}`
        const model = new MockLanguageModelV3({
          doGenerate: async (): Promise<LanguageModelV3GenerateResult> => ({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  assessments: [
                    {
                      claim: fixture.answer,
                      support: fixture.judgment,
                      explanation: fixture.explanation,
                      sourceIds: 'quote' in fixture ? [sourceId] : [],
                      quoteEvidence:
                        'quote' in fixture
                          ? [{ sourceId, quote: fixture.quote }]
                          : [],
                    },
                  ],
                }),
              },
            ],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 1, noCache: 1 },
              outputTokens: { total: 1, text: 1 },
            },
            warnings: [],
          }),
        })

        const result = await assessResearchSupport({
          model,
          answer: fixture.answer,
          evidence: [
            {
              id: sourceId,
              excerpt: fixture.excerpt,
              source: {
                url: `https://archive.example.test/record-${index + 1}`,
                label: 'archive.example.test',
              },
            },
          ],
        })
        return { fixture, result, sourceId }
      }),
    )

    expect(
      results.map(({ fixture, result }) => [
        fixture.name,
        result.status,
        result.assessments[0]?.support,
      ]),
    ).toEqual(
      cases.map((fixture) => [fixture.name, 'completed', fixture.judgment]),
    )

    for (const { fixture, result, sourceId } of results) {
      const [assessment] = result.assessments
      expect(assessment.claim).toBe(fixture.answer)
      expect(assessment.sourceIds).toEqual('quote' in fixture ? [sourceId] : [])
      if ('quote' in fixture) {
        expect(assessment.quoteEvidence).toEqual([
          { sourceId, quote: fixture.quote },
        ])
        expect(assessment.sources).toHaveLength(1)
      } else {
        expect(assessment.quoteEvidence).toEqual([])
        expect(assessment.sources).toEqual([])
      }
    }
  })

  it('downgrades a nominally supported claim when its quote does not occur in the cited excerpt', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async (): Promise<LanguageModelV3GenerateResult> => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              assessments: [
                {
                  claim: 'The Kestrel bridge opened in 2018.',
                  support: 'supported',
                  explanation: 'The source confirms this.',
                  sourceIds: ['src_eval_bad_quote'],
                  quoteEvidence: [
                    { sourceId: 'src_eval_bad_quote', quote: 'opened in 2018' },
                    { sourceId: 'src_eval_bad_quote', quote: '   ' },
                  ],
                },
              ],
            }),
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1 },
          outputTokens: { total: 1, text: 1 },
        },
        warnings: [],
      }),
    })
    const result = await assessResearchSupport({
      model,
      answer: 'The Kestrel bridge opened in 2018.',
      evidence: [{ id: 'src_eval_bad_quote', excerpt: 'It opened in 2021.' }],
    })

    expect(result.status).toBe('completed')
    expect(result.assessments[0]).toMatchObject({
      support: 'unclear',
      sourceIds: [],
      quoteEvidence: [],
      sources: [],
    })
  })
})
