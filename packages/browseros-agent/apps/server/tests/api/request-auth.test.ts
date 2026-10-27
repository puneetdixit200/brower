import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Env } from '../../src/api/types'
import {
  isTrustedAppOrigin,
  requireTrustedAppOrigin,
} from '../../src/api/utils/request-auth'

const localServer = {
  server: {
    requestIP: () => ({ address: '127.0.0.1' }),
  },
} as never

describe('request auth', () => {
  it('accepts loopback and extension origins', () => {
    expect(isTrustedAppOrigin('http://127.0.0.1:9105')).toBe(true)
    expect(isTrustedAppOrigin('http://localhost:3000')).toBe(true)
    expect(isTrustedAppOrigin('chrome-extension://browseros')).toBe(true)
    expect(isTrustedAppOrigin('moz-extension://browseros')).toBe(true)
  })

  it('rejects missing and untrusted origins', () => {
    expect(isTrustedAppOrigin(undefined)).toBe(false)
    expect(isTrustedAppOrigin('https://example.com')).toBe(false)
    expect(isTrustedAppOrigin('file:///tmp/app.html')).toBe(false)
  })

  it('blocks requests from untrusted origins', async () => {
    const app = new Hono<Env>()
      .use('/*', requireTrustedAppOrigin())
      .get('/agents/status', (c) => c.json({ ok: true }))

    const res = await app.request('http://localhost/agents/status', {
      headers: { Origin: 'https://evil.example' },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('allows requests from trusted origins', async () => {
    const app = new Hono<Env>()
      .use('/*', requireTrustedAppOrigin())
      .get('/agents/status', (c) => c.json({ ok: true }))

    const res = await app.request(
      'http://localhost/agents/status',
      {
        headers: {
          Host: 'localhost',
          Origin: 'chrome-extension://browseros',
        },
      },
      localServer,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it.each([
    ['chrome-extension://browseros', 'chrome-extension://browseros/app.html'],
    ['moz-extension://browseros', 'moz-extension://browseros/app.html'],
  ])(
    'allows a matching extension Referer and Origin',
    async (origin, referer) => {
      const response = await authProbe({ origin, referer })
      expect(response.status).toBe(200)
    },
  )

  it('preserves localhost Referer requests', async () => {
    const response = await authProbe({
      origin: 'chrome-extension://browseros',
      referer: 'http://localhost:5173/app.html',
    })
    expect(response.status).toBe(200)
  })

  it.each([
    {
      origin: 'chrome-extension://browseros',
      referer: 'chrome-extension://another-extension/app.html',
    },
    {
      origin: 'chrome-extension://browseros',
      referer: 'https://example.com/app.html',
    },
    {
      origin: 'moz-extension://browseros',
      referer: 'chrome-extension://browseros/app.html',
    },
    {
      origin: undefined,
      referer: 'chrome-extension://browseros/app.html',
    },
  ])(
    'rejects mismatched or non-extension Referer metadata',
    async (headers) => {
      const response = await authProbe(headers)
      expect(response.status).toBe(403)
    },
  )

  it('still requires loopback Host and socket for extension Referers', async () => {
    const nonLoopbackHost = await authProbe({
      origin: 'chrome-extension://browseros',
      referer: 'chrome-extension://browseros/app.html',
      host: 'example.com',
    })
    const nonLoopbackSocket = await authProbe(
      {
        origin: 'chrome-extension://browseros',
        referer: 'chrome-extension://browseros/app.html',
      },
      {
        server: {
          requestIP: () => ({ address: '203.0.113.10' }),
        },
      } as never,
    )
    expect(nonLoopbackHost.status).toBe(403)
    expect(nonLoopbackSocket.status).toBe(403)
  })

  it('allows the actual originless extension state GET metadata on loopback', async () => {
    const response = await stateReadProbe({
      host: 'localhost',
      secFetchSite: 'none',
    })
    expect(response.status).toBe(200)
  })

  it('requires Sec-Fetch-Site none and no Referer for originless state GETs', async () => {
    const noFetchMetadata = await stateReadProbe({ host: 'localhost' })
    const remoteReferer = await stateReadProbe({
      host: 'localhost',
      secFetchSite: 'none',
      referer: 'https://example.com/page',
    })
    const localhostReferer = await stateReadProbe({
      host: 'localhost',
      secFetchSite: 'none',
      referer: 'http://localhost:5173/app',
    })
    expect(noFetchMetadata.status).toBe(403)
    expect(remoteReferer.status).toBe(403)
    expect(localhostReferer.status).toBe(403)
  })

  it('rejects remote Origin and non-loopback requests on state reads', async () => {
    const remoteOrigin = await stateReadProbe({
      host: 'localhost',
      origin: 'https://example.com',
      referer: 'https://example.com/page',
    })
    const remoteHost = await stateReadProbe({
      host: 'example.com',
      secFetchSite: 'none',
    })
    const remoteSocket = await stateReadProbe(
      {
        host: 'localhost',
        secFetchSite: 'none',
      },
      {
        server: {
          requestIP: () => ({ address: '203.0.113.10' }),
        },
      } as never,
    )
    expect(remoteOrigin.status).toBe(403)
    expect(remoteHost.status).toBe(403)
    expect(remoteSocket.status).toBe(403)
  })
})

async function authProbe(
  headers: {
    origin?: string
    referer?: string
    host?: string
  },
  server = localServer,
): Promise<Response> {
  const app = new Hono<Env>()
    .use('/*', requireTrustedAppOrigin())
    .get('/chat/state', (c) => c.json({ ok: true }))
  const requestHeaders = new Headers({
    Host: headers.host ?? 'localhost',
  })
  if (headers.origin) requestHeaders.set('Origin', headers.origin)
  if (headers.referer) requestHeaders.set('Referer', headers.referer)
  return app.request(
    'http://localhost/chat/state',
    { headers: requestHeaders },
    server,
  )
}

async function stateReadProbe(
  headers: {
    origin?: string
    referer?: string
    host: string
    secFetchSite?: string
  },
  server = localServer,
): Promise<Response> {
  const app = new Hono<Env>()
    .use(
      '/*',
      requireTrustedAppOrigin({
        requireOrigin: true,
        allowOriginlessTaskStateRead: true,
      }),
    )
    .get('/chat/:conversationId/state', (c) => c.json({ ok: true }))
  const requestHeaders = new Headers({ Host: headers.host })
  if (headers.origin) requestHeaders.set('Origin', headers.origin)
  if (headers.referer) requestHeaders.set('Referer', headers.referer)
  if (headers.secFetchSite) {
    requestHeaders.set('Sec-Fetch-Site', headers.secFetchSite)
  }
  return app.request(
    'http://localhost/chat/test-conversation/state',
    { headers: requestHeaders },
    server,
  )
}
