import { describe, expect, it } from 'bun:test'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV3 } from 'ai/test'
import {
  addToolEnvelopeBoundary,
  buildAgentToolRunContexts,
} from '../../src/agent/ai-sdk-agent'
import {
  assessResearchSupport,
  beginResearchEvidenceCapture,
  captureSuccessfulBuiltInRead,
  cleanupResearchEvidenceOnStreamEnd,
  clearResearchEvidence,
  extractCurrentTurnAssistantText,
  isEligibleResearchSupportRequest,
  selectBoundedResearchEvidence,
  takeResearchEvidence,
} from '../../src/agent/research-support-assessment'

const research =
  'Research request (Aster, explicit user initiation): Find relevant sources.'

describe('research support assessment', () => {
  it('requires explicit opt-in on an explicit BrowserOS research turn', () => {
    expect(
      isEligibleResearchSupportRequest({
        optedIn: true,
        mode: 'agent',
        scheduled: false,
        message: research,
      }),
    ).toBe(true)
    for (const input of [
      {
        optedIn: false,
        mode: 'agent' as const,
        scheduled: false,
        message: research,
      },
      {
        optedIn: true,
        mode: 'chat' as const,
        scheduled: false,
        message: research,
      },
      {
        optedIn: true,
        mode: 'agent' as const,
        scheduled: true,
        message: research,
      },
      {
        optedIn: true,
        mode: 'agent' as const,
        scheduled: false,
        message: 'ordinary chat',
      },
    ]) {
      expect(isEligibleResearchSupportRequest(input)).toBe(false)
    }
  })

  it('captures only bounded outputs while a server turn collector is active', () => {
    const taskId = crypto.randomUUID()
    captureSuccessfulBuiltInRead(taskId, 'renderer supplied evidence')
    beginResearchEvidenceCapture(taskId)
    captureSuccessfulBuiltInRead(taskId, {
      text: 'a'.repeat(20_000),
      url: 'https://example.test/private?token=secret',
    })
    captureSuccessfulBuiltInRead(taskId, { text: 'second excerpt' })
    const selected = takeResearchEvidence(taskId)
    expect(selected).toHaveLength(2)
    expect(selected[0].length).toBeLessThanOrEqual(1_200)
    expect(selected[0]).not.toContain('https://')
    expect(selected[0]).not.toContain('token=secret')
    expect(selected[1]).toContain('second excerpt')
    captureSuccessfulBuiltInRead(taskId, 'late output')
    expect(takeResearchEvidence(taskId)).toEqual([])
    beginResearchEvidenceCapture(taskId)
    clearResearchEvidence(taskId)
    expect(takeResearchEvidence(taskId)).toEqual([])
  })

  it('captures evidence only from successful built-in read execution', async () => {
    const taskId = crypto.randomUUID()
    beginResearchEvidenceCapture(taskId)
    let readCalls = 0
    const tools = addToolEnvelopeBoundary({
      read: {
        execute: async () =>
          ++readCalls === 1
            ? { text: 'trusted page excerpt' }
            : { isError: true, text: 'failed result' },
      },
      custom_read: {
        execute: async () => ({ text: 'custom tool output' }),
      },
    } as never) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >
    const context = { taskId, assessResearchSupport: true }
    await tools.read.execute({}, { context })
    await tools.read.execute({}, { context })
    await tools.custom_read.execute({}, { context })
    const evidence = takeResearchEvidence(taskId)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toContain('trusted page excerpt')
    expect(evidence[0]).not.toContain('custom tool output')
    expect(evidence[0]).not.toContain('failed result')
  })

  it('clears captured excerpts when the assessment stream errors or is canceled', async () => {
    const errorTaskId = crypto.randomUUID()
    beginResearchEvidenceCapture(errorTaskId)
    captureSuccessfulBuiltInRead(errorTaskId, 'private excerpt')
    const errorController = new AbortController()
    const errored = cleanupResearchEvidenceOnStreamEnd({
      taskId: errorTaskId,
      signal: errorController.signal,
      stream: new ReadableStream<string>({
        start(controller) {
          controller.error(new Error('stream failed'))
        },
      }),
    })
    await expect(errored.getReader().read()).rejects.toThrow('stream failed')
    expect(takeResearchEvidence(errorTaskId)).toEqual([])

    const canceledTaskId = crypto.randomUUID()
    beginResearchEvidenceCapture(canceledTaskId)
    captureSuccessfulBuiltInRead(canceledTaskId, 'private excerpt')
    const cancelController = new AbortController()
    const canceled = cleanupResearchEvidenceOnStreamEnd({
      taskId: canceledTaskId,
      signal: cancelController.signal,
      stream: new ReadableStream<string>({ start() {} }),
    })
    await canceled.getReader().cancel()
    expect(takeResearchEvidence(canceledTaskId)).toEqual([])
  })

  it('clears captured excerpts when the research request is aborted', async () => {
    const taskId = crypto.randomUUID()
    beginResearchEvidenceCapture(taskId)
    captureSuccessfulBuiltInRead(taskId, 'private excerpt')
    const abortController = new AbortController()
    const stream = cleanupResearchEvidenceOnStreamEnd({
      taskId,
      signal: abortController.signal,
      stream: new ReadableStream<string>({ start() {} }),
    })
    const reader = stream.getReader()
    abortController.abort()
    expect(takeResearchEvidence(taskId)).toEqual([])
    await reader.cancel()
  })

  it('propagates the per-call opt-in into built-in tool execution contexts', () => {
    const tools = { read: { contextSchema: {} } } as never
    const taskId = crypto.randomUUID()
    expect(buildAgentToolRunContexts(tools, taskId, true)).toEqual({
      read: { taskId, assessResearchSupport: true },
    })
    expect(buildAgentToolRunContexts(tools, taskId, false)).toEqual({
      read: { taskId, assessResearchSupport: false },
    })
  })

  it('never reuses an earlier assistant answer when the current turn has none', () => {
    const priorMessages = [
      {
        id: 'prior-answer',
        role: 'assistant',
        parts: [{ type: 'text', text: 'previous answer' }],
      },
      { id: 'current-user', role: 'user', parts: [] },
    ]
    expect(extractCurrentTurnAssistantText(priorMessages, 'current-user')).toBe(
      '',
    )
    expect(extractCurrentTurnAssistantText(priorMessages, undefined)).toBe('')
    expect(
      extractCurrentTurnAssistantText(
        [
          ...priorMessages,
          {
            id: 'current-answer',
            role: 'assistant',
            parts: [{ type: 'text', text: 'current answer' }],
          },
        ],
        'current-user',
      ),
    ).toBe('current answer')
  })

  it('bounds evidence count and per-excerpt length', () => {
    expect(
      selectBoundedResearchEvidence(
        Array.from({ length: 9 }, () => 'x'.repeat(4_000)),
      ),
    ).toHaveLength(4)
    expect(selectBoundedResearchEvidence(['x'.repeat(4_000)])[0]).toHaveLength(
      1_200,
    )
  })

  it('fails closed without evidence and does not throw on verifier failure', async () => {
    const noEvidence = await assessResearchSupport({
      model: {} as never,
      answer: 'answer',
      evidence: [],
    })
    expect(noEvidence).toEqual({ status: 'unavailable', assessments: [] })

    const failed = await assessResearchSupport({
      model: {} as never,
      answer: 'answer',
      evidence: ['excerpt'],
    })
    expect(failed).toEqual({ status: 'unavailable', assessments: [] })

    const abortController = new AbortController()
    abortController.abort()
    const aborted = await assessResearchSupport({
      model: {} as never,
      answer: 'answer',
      evidence: ['excerpt'],
      signal: abortController.signal,
    })
    expect(aborted).toEqual({ status: 'unavailable', assessments: [] })
  })

  it('returns a valid structured assessment with sanitized bounded text', async () => {
    const maxClaim = 'c'.repeat(500)
    const maxExplanation = 'e'.repeat(600)
    const model = new MockLanguageModelV3({
      doGenerate: async (): Promise<LanguageModelV3GenerateResult> => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              assessments: [
                {
                  claim: maxClaim,
                  support: 'supported',
                  explanation: maxExplanation,
                },
                {
                  claim:
                    'Claim from https://private.example.test/path?token=secret',
                  support: 'mixed',
                  explanation:
                    'Evidence at https://private.example.test/source?key=secret',
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
      answer: 'The page supports the claim.',
      evidence: ['The page says the claim is true.'],
    })

    expect(result.status).toBe('completed')
    expect(result.assessments).toHaveLength(2)
    expect(result.assessments[0]).toMatchObject({ support: 'supported' })
    expect(result.assessments[0].claim).toBe(maxClaim)
    expect(result.assessments[0].claim).toHaveLength(500)
    expect(result.assessments[0].explanation).toBe(maxExplanation)
    expect(result.assessments[0].explanation).toHaveLength(600)
    expect(result.assessments[1]).toMatchObject({ support: 'mixed' })
    expect(result.assessments[1].claim).toContain('[source URL omitted]')
    expect(result.assessments[1].claim).not.toContain('https://')
    expect(result.assessments[1].claim).not.toContain('token=secret')
    expect(result.assessments[1].explanation).toContain('[source URL omitted]')
    expect(result.assessments[1].explanation).not.toContain('https://')
    expect(result.assessments[1].explanation).not.toContain('key=secret')
  })
})
