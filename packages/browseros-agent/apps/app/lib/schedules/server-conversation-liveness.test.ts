import { describe, expect, it } from 'bun:test'
import { getServerConversationLiveness } from './server-conversation-liveness'

const conversationId = '11111111-1111-4111-8111-111111111111'
const agentServerUrl = 'http://127.0.0.1:9222'

const probe = async (body: unknown, status = 200) =>
  getServerConversationLiveness({
    conversationId,
    agentServerUrl,
    fetcher: async () => Response.json(body, { status }),
  })

describe('heartbeat server liveness', () => {
  it('retains the server turn when the extension loses its controller', async () => {
    expect(
      await probe({ conversationId, runId: 'run-1', status: 'running' }),
    ).toBe('active')
  })

  it('recognizes only explicit terminal and exact missing-run responses', async () => {
    for (const status of ['completed', 'aborted', 'failed', 'interrupted']) {
      expect(await probe({ conversationId, status })).toBe('inactive')
    }
    expect(await probe({ error: 'Conversation not found' }, 404)).toBe(
      'inactive',
    )
  })

  it('rejects changed contracts and unrelated 404 responses', async () => {
    expect(
      await probe({ conversationId: 'different', status: 'running' }),
    ).toBe('unknown')
    expect(await probe({ conversationId, status: 'paused' })).toBe('unknown')
    expect(await probe({ error: 'Unknown route' }, 404)).toBe('unknown')
    expect(
      await getServerConversationLiveness({
        conversationId,
        agentServerUrl,
        fetcher: async () => new Response('', { status: 503 }),
      }),
    ).toBe('unknown')
  })

  it('never fetches invalid conversation IDs or non-loopback addresses', async () => {
    const fetcher = async () => {
      throw new Error('should not fetch')
    }
    for (const [id, base] of [
      ['not-an-id', agentServerUrl],
      [conversationId, 'https://example.com'],
      [conversationId, 'http://localhost:9222'],
    ]) {
      expect(
        await getServerConversationLiveness({
          conversationId: id,
          agentServerUrl: base,
          fetcher,
        }),
      ).toBe('unknown')
    }
  })

  it('treats connection failures as unknown, not abandoned', async () => {
    expect(
      await getServerConversationLiveness({
        conversationId,
        agentServerUrl,
        fetcher: async () => {
          throw new Error('connection reset')
        },
      }),
    ).toBe('unknown')
  })

  it('does not follow redirects outside the loopback trust boundary', async () => {
    let redirectMode: RequestRedirect | undefined
    const result = await getServerConversationLiveness({
      conversationId,
      agentServerUrl,
      fetcher: async (_url, init) => {
        redirectMode = init.redirect
        if (init.redirect === 'error') {
          throw new TypeError('redirect disallowed')
        }
        return Response.json({ conversationId, status: 'completed' })
      },
    })

    expect(redirectMode).toBe('error')
    expect(result).toBe('unknown')
  })

  it('keeps the claim when the loopback endpoint redirects', async () => {
    let redirectedRequestCount = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/redirect-target') {
          redirectedRequestCount += 1
          return Response.json({ conversationId, status: 'completed' })
        }
        return Response.redirect(new URL('/redirect-target', request.url), 302)
      },
    })
    try {
      expect(
        await getServerConversationLiveness({
          conversationId,
          agentServerUrl: `http://127.0.0.1:${server.port}`,
        }),
      ).toBe('unknown')
      expect(redirectedRequestCount).toBe(0)
    } finally {
      server.stop(true)
    }
  })
})
