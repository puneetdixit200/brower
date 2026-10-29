import { describe, expect, it, mock } from 'bun:test'
import {
  fetchHumanIntervention,
  resumeHumanIntervention,
  startFreshHumanConversation,
} from './human-intervention-client'

describe('fetchHumanIntervention', () => {
  it('accepts a complete wait for the requested conversation', async () => {
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            runId: 'run-1',
            requestId: 'request-1',
            phase: 'waiting',
          }),
        ),
    )

    await expect(
      fetchHumanIntervention('conversation/a', {
        resolveServerUrl: async () => 'http://127.0.0.1:1234',
        fetchImpl,
      }),
    ).resolves.toEqual({
      runId: 'run-1',
      requestId: 'request-1',
      phase: 'waiting',
    })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/chat/conversation%2Fa/intervention',
    )
  })

  it('treats the empty and malformed response forms as no active wait', async () => {
    const resolveServerUrl = async () => 'http://127.0.0.1:1234'
    for (const value of [
      { runId: null, requestId: null },
      { runId: 'run-1', requestId: null },
      { runId: '', requestId: 'request-1' },
      { runId: 'run-1', requestId: 'request-1', phase: 'resuming' },
    ]) {
      await expect(
        fetchHumanIntervention('conversation-id', {
          resolveServerUrl,
          fetchImpl: mock(async () => new Response(JSON.stringify(value))),
        }),
      ).resolves.toBeNull()
    }
  })
})

describe('startFreshHumanConversation', () => {
  it('posts the exact interrupted identity and accepts only a new conversation id', async () => {
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            conversationId: 'b1c53b82-84ad-4fe8-8fbb-e482098ef216',
          }),
          { status: 200 },
        ),
    )

    await expect(
      startFreshHumanConversation(
        {
          conversationId: 'old-conversation-id',
          runId: 'interrupted-run-id',
          requestId: 'interrupted-wait-id',
        },
        {
          resolveServerUrl: async () => 'http://127.0.0.1:1234',
          fetchImpl,
        },
      ),
    ).resolves.toBe('b1c53b82-84ad-4fe8-8fbb-e482098ef216')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/intervention/interrupted-wait-id/fresh',
    )
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ runId: 'interrupted-run-id' }),
    })
  })

  it('rejects failed and malformed authorization responses', async () => {
    const failed = mock(async () => new Response('{}', { status: 409 }))
    const malformed = mock(
      async () => new Response(JSON.stringify({ runId: 'run-2' })),
    )

    const input = {
      conversationId: 'old-conversation-id',
      runId: 'interrupted-run-id',
      requestId: 'interrupted-wait-id',
    }
    await expect(
      startFreshHumanConversation(input, {
        resolveServerUrl: async () => 'http://127.0.0.1:1234',
        fetchImpl: failed,
      }),
    ).resolves.toBeNull()
    await expect(
      startFreshHumanConversation(input, {
        resolveServerUrl: async () => 'http://127.0.0.1:1234',
        fetchImpl: malformed,
      }),
    ).resolves.toBeNull()
  })
})

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
