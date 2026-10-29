import type { LLMProvider } from '@browseros/shared/schemas/llm'
import type {
  ResearchEvidence,
  ResearchSupportResult,
} from '../../src/agent/research-support-assessment'

export type ExpectedSupport = 'supported' | 'mixed' | 'unsupported' | 'unclear'

export type EvaluationCase = {
  id: string
  expected: ExpectedSupport
  answer: string
  evidence: ResearchEvidence[]
}

const source = (id: string, excerpt: string): ResearchEvidence => ({
  id,
  excerpt,
  source: { url: `https://example.test/${id}`, label: 'example.test' },
})

export const EVALUATION_CASES: EvaluationCase[] = [
  {
    id: 'supporting',
    expected: 'supported',
    answer: 'The sample weighs 12 grams.',
    evidence: [source('src_support', 'The sample weighs 12 grams.')],
  },
  {
    id: 'irrelevant',
    expected: 'unclear',
    answer: 'The sample weighs 12 grams.',
    evidence: [
      source('src_irrelevant', 'The sample was collected on Tuesday.'),
    ],
  },
  {
    id: 'contradictory',
    expected: 'unsupported',
    answer: 'The sample weighs 12 grams.',
    evidence: [source('src_contradiction', 'The sample weighs 9 grams.')],
  },
  {
    id: 'incomplete',
    expected: 'unclear',
    answer: 'The sample weighs 12 grams and is made of copper.',
    evidence: [source('src_incomplete', 'The sample weighs 12 grams.')],
  },
]

export type AssessmentInput = {
  answer: string
  evidence: ResearchEvidence[]
}
export type AssessmentRunner = (
  input: AssessmentInput,
) => Promise<ResearchSupportResult>

export type EvaluationSummary = {
  cases: Array<{
    id: string
    expected: ExpectedSupport
    returned: ExpectedSupport | 'unavailable'
    matched: boolean
    quoteCount: number
    boundQuoteCount: number
    sourceCount: number
    sourceIdsBound: boolean
  }>
  passed: number
  total: number
}

/** Summarizes labels and binding counts only; it never returns model text. */
export async function evaluateResearchSupport(
  runAssessment: AssessmentRunner,
): Promise<EvaluationSummary> {
  const cases = []
  for (const scenario of EVALUATION_CASES) {
    const result = await runAssessment({
      answer: scenario.answer,
      evidence: scenario.evidence,
    })
    const assessment = result.assessments[0]
    const returned =
      result.status === 'completed' && assessment
        ? assessment.support
        : 'unavailable'
    const quoteCount = assessment?.quoteEvidence.length ?? 0
    const boundQuoteCount =
      assessment?.quoteEvidence.filter((quote) =>
        scenario.evidence.some(
          (item) =>
            item.id === quote.sourceId && item.excerpt.includes(quote.quote),
        ),
      ).length ?? 0
    const sourceIdsBound = (assessment?.sourceIds ?? []).every((id) =>
      scenario.evidence.some((item) => item.id === id),
    )
    cases.push({
      id: scenario.id,
      expected: scenario.expected,
      returned,
      matched: returned === scenario.expected,
      quoteCount,
      boundQuoteCount,
      sourceCount: assessment?.sources.length ?? 0,
      sourceIdsBound,
    })
  }
  return {
    cases,
    passed: cases.filter(
      (item) =>
        item.matched &&
        item.quoteCount === item.boundQuoteCount &&
        item.sourceIdsBound,
    ).length,
    total: cases.length,
  }
}

const ALLOWED_PROVIDERS = new Set<LLMProvider>([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'azure',
  'ollama',
  'lmstudio',
  'openai-compatible',
  'moonshot',
])

export type LiveConfig = {
  provider: LLMProvider
  model: string
  apiKey?: string
  baseUrl?: string
  resourceName?: string
}

export function readLiveConfig(
  env: Record<string, string | undefined>,
): LiveConfig {
  const providerName = env.T26_LIVE_PROVIDER
  const model = env.T26_LIVE_MODEL
  if (!providerName || !model) {
    throw new Error(
      'Set T26_LIVE_PROVIDER and T26_LIVE_MODEL to run live evaluation.',
    )
  }
  if (!ALLOWED_PROVIDERS.has(providerName as LLMProvider)) {
    throw new Error(
      'T26_LIVE_PROVIDER must name a supported direct or compatible provider.',
    )
  }
  const provider = providerName as LLMProvider
  const apiKey = env.T26_LIVE_API_KEY
  const baseUrl = env.T26_LIVE_BASE_URL
  const resourceName = env.T26_LIVE_RESOURCE_NAME
  if (
    ['anthropic', 'openai', 'google', 'openrouter', 'moonshot'].includes(
      provider,
    ) &&
    !apiKey
  ) {
    throw new Error('T26_LIVE_API_KEY is required for the selected provider.')
  }
  if (
    ['ollama', 'lmstudio', 'openai-compatible', 'moonshot'].includes(
      provider,
    ) &&
    !baseUrl
  ) {
    throw new Error('T26_LIVE_BASE_URL is required for the selected provider.')
  }
  if (provider === 'azure' && !apiKey) {
    throw new Error('T26_LIVE_API_KEY is required for Azure.')
  }
  if (provider === 'azure' && !baseUrl && !resourceName) {
    throw new Error(
      'Set T26_LIVE_BASE_URL or T26_LIVE_RESOURCE_NAME for Azure.',
    )
  }
  if (
    ['ollama', 'lmstudio', 'openai-compatible'].includes(provider) &&
    !baseUrl
  ) {
    throw new Error('T26_LIVE_BASE_URL is required for the selected provider.')
  }
  return { provider, model, apiKey, baseUrl, resourceName }
}

export async function runLiveEvaluation(
  config: LiveConfig,
): Promise<EvaluationSummary> {
  if (process.env.BROWSEROS_USE_MOCK_LLM === 'true') {
    throw new Error('Disable BROWSEROS_USE_MOCK_LLM before live evaluation.')
  }
  const [{ createLanguageModel }, { assessResearchSupport }] =
    await Promise.all([
      import('../../src/agent/provider-factory'),
      import('../../src/agent/research-support-assessment'),
    ])
  const { model } = await createLanguageModel({
    conversationId: 't26-live-eval',
    ...config,
  })
  return evaluateResearchSupport((input) =>
    assessResearchSupport({ ...input, model }),
  )
}

if (import.meta.main) {
  if (!process.argv.includes('--live')) {
    console.log(
      'Offline-safe: no provider called. Pass --live to enable live evaluation.',
    )
  } else {
    try {
      const config = readLiveConfig(process.env)
      const summary = await runLiveEvaluation(config)
      console.log(
        JSON.stringify(
          { provider: config.provider, model: config.model, ...summary },
          null,
          2,
        ),
      )
    } catch {
      console.error(
        'Live evaluation failed. Check T26_LIVE_* configuration and provider availability; no secrets or response content were logged.',
      )
      process.exitCode = 1
    }
  }
}
