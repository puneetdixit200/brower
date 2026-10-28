import { describe, expect, it } from 'bun:test'
import { getServerConversationLiveness } from './server-conversation-liveness'

const conversationId = '11111111-1111-4111-8111-111111111111'
const agentServerUrl = 'http://127.0.0.1:9222'
const check = (response: Response) =>
  getServerConversationLiveness({
    conversationId,
    agentServerUrl,
    fetcher: async () => response,
  })

describe('heartbeat server liveness', () => {
  it('retains an ongoing server run even when the old extension worker lost its controller', async () => {
    expect(await check(Response.json({
      conversationId,
      runId: 'run-1',
      status: 'running',
    }))).toBe('active')
  })

  it('allows cleanup only after an explicit terminal or contract-valid missing run', async () => {
    for (const status of ['completed', 'aborted', 'failed', 'interrupted']) {
      expect(await check(Response.json({ conversationId, status }))).toBe('inactive')
    }
    expect(await check(Response.json(
      { error: 'Conversation not found' },
      { status: 404 },
    ))).toBe('inactive')
  })

  it('fails closed for changed contracts, wrong run IDs and generic 404 pages', async () => {
    expect(await check(Response.json({ conversationId: 'different', status: 'running' }))).toBe('unknown')
    expect(await check(Response.json({ conversationId, status: 'paused' }))).toBe('unknown')
    expect(await check(Response.json({ error: 'Unknown route' }, { status: 404 }))).toBe('unknown')
    expect(await check(new Response('', { status: 503 }))).toBe('unknown')
  })

  it('rejects invalid destination origins and malformed conversation identities', async () => {
    const fetcher = async () => { throw new Error('should never fetch') }
    expect(await getServerConversationLiveness({
      conversationId: 'not-an-id', agentServerUrl, fetcher,
    })).toBe('unknown')
    expect(await getServerConversationLiveness({
      conversationId, agentServerUrl: 'https://example.com', fetcher,
    })).toBe('unknown')
    expect(await getServerConversationLiveness({
      conversationId, agentServerUrl: 'http://localhost:9222', fetcher,
    })).toBe('unknown')
  })

  it('does not reinterpret a timeout or transport failure as proof a task stopped', async () => {
    expect(await getServerConversationLiveness({
      conversationId, agentServerUrl,
      fetcher: async () => { throw new Error('connection reset') },
    })).toBe('unknown')
  })
})
