import { describe, expect, it, mock } from 'bun:test'
import { resumeHumanIntervention } from './human-intervention-client'

describe('resumeHumanIntervention', () => {
  it('retries the initial gate-registration race and succeeds on the exact request', async () => {
    const fetchImpl = mock()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ resumed: true }), { status: 200 }),
      )
    const wait = mock(async () => {})

    await expect(
      resumeHumanIntervention(
        {
          conversationId: 'conversation-id',
          runId: 'run-id',
          requestId: 'opaque-request-id',
        },
        {
          resolveServerUrl: async () => 'http://127.0.0.1:1234',
          fetchImpl,
          wait,
        },
      ),
    ).resolves.toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(100)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/intervention/opaque-request-id/resume',
    )
  })

  it('stops retrying when the run/request is stale', async () => {
    const fetchImpl = mock(async () => new Response('{}', { status: 409 }))
    const wait = mock(async () => {})

    await expect(
      resumeHumanIntervention(
        {
          conversationId: 'conversation-id',
          runId: 'run-id',
          requestId: 'stale-request-id',
        },
        {
          resolveServerUrl: async () => 'http://127.0.0.1:1234',
          fetchImpl,
          wait,
        },
      ),
    ).resolves.toBe(false)

    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(wait).toHaveBeenCalledTimes(3)
  })
})
