import { describe, expect, it, mock } from 'bun:test'
import {
  conversationReconnectUrl,
  fetchConversationRunState,
  resolveConversationRunMessages,
} from './conversation-run-client'

describe('conversation run client', () => {
  it('loads the server-owned base messages for a panel', async () => {
    const fetchImpl = mock(async () =>
      Response.json({
        conversationId: 'conversation/one',
        runId: 'run-1',
        status: 'running',
        messages: [{ id: 'user-1', role: 'user', parts: [] }],
      }),
    )

    const state = await fetchConversationRunState(
      'http://127.0.0.1:9000',
      'conversation/one',
      fetchImpl as unknown as typeof fetch,
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/chat/conversation%2Fone/state',
      { cache: 'no-store' },
    )
    expect(state.status).toBe('running')
    expect(state.messages?.[0]?.id).toBe('user-1')
  })

  it('builds the AI SDK reconnect endpoint from the conversation id', () => {
    expect(
      conversationReconnectUrl('http://127.0.0.1:9000', 'conversation/one'),
    ).toBe('http://127.0.0.1:9000/chat/conversation%2Fone/stream')
  })

  it('accepts metadata-only interrupted state and preserves available transcript messages', async () => {
    const state = await fetchConversationRunState(
      'http://127.0.0.1:9000',
      'conversation',
      (async () =>
        Response.json({
          conversationId: 'conversation',
          runId: 'run-old',
          status: 'interrupted',
          startedAt: 100,
          finishedAt: 200,
        })) as unknown as typeof fetch,
    )
    const transcript = [
      { id: 'assistant-1', role: 'assistant' as const, parts: [] },
    ]
    expect(state.status).toBe('interrupted')
    expect(state.messages).toBeUndefined()
    for (const status of [
      'interrupted',
      'completed',
      'aborted',
      'failed',
    ] as const) {
      expect(
        resolveConversationRunMessages({ ...state, status }, transcript),
      ).toEqual(transcript)
    }
    expect(
      resolveConversationRunMessages(
        state,
        [],
        [{ id: 'user-1', role: 'user', parts: [] }],
      ),
    ).toEqual([{ id: 'user-1', role: 'user', parts: [] }])
  })

  it('pins reconnects to the hydrated run instead of whichever turn is newest', () => {
    expect(
      conversationReconnectUrl('http://localhost:9000', 'chat', 'run/new'),
    ).toBe('http://localhost:9000/chat/chat/stream?runId=run%2Fnew')
  })

  it('rejects malformed state instead of poisoning React chat state', async () => {
    await expect(
      fetchConversationRunState(
        'http://127.0.0.1:9000',
        'conversation',
        (async () =>
          Response.json({ status: 'running' })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Invalid active conversation state')
  })
})
