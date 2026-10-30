import { describe, expect, it, mock } from 'bun:test'
import { stopConversationView } from './stop-conversation'

describe('stop conversation view', () => {
  it('detaches after the server confirms the stop', async () => {
    const events: string[] = []
    const fetchImpl = mock(async () => {
      events.push('request')
      return new Response(null, { status: 200 })
    })
    const detachView = mock(async () => {
      events.push('detach')
    })

    await stopConversationView({
      serverUrl: 'http://127.0.0.1:9000',
      conversationId: 'conversation/one',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      detachView,
    })

    expect(events).toEqual(['request', 'detach'])
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/chat/conversation%2Fone/stop',
      { method: 'POST' },
    )
    expect(detachView).toHaveBeenCalledTimes(1)
  })

  it('keeps the view attached when the server stop request fails', async () => {
    const detachView = mock(async () => {})

    await expect(
      stopConversationView({
        serverUrl: 'http://127.0.0.1:9000',
        conversationId: 'conversation',
        fetchImpl: (async () =>
          new Response(null, { status: 503 })) as unknown as typeof fetch,
        detachView,
      }),
    ).rejects.toThrow('Conversation stop failed (503)')
    expect(detachView).not.toHaveBeenCalled()
  })

  it('detaches when the server confirms there is no active run', async () => {
    const detachView = mock(async () => {})

    await stopConversationView({
      serverUrl: 'http://127.0.0.1:9000',
      conversationId: 'conversation',
      fetchImpl: (async () =>
        Response.json({ stopped: false })) as unknown as typeof fetch,
      detachView,
    })

    expect(detachView).toHaveBeenCalledTimes(1)
  })
})
