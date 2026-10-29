import { FIXTURE_PAGES, SPOTTING_PAGES } from './catalog'

export interface CaptchaFixtureServer {
  origin: string
  frameOrigin: string
  url(path: string): string
  stop(): Promise<void>
}
type Vendor = 'recaptcha_v2' | 'turnstile' | 'hcaptcha'
const MAX_DUMMY_MFA_BODY_BYTES = 16 * 1024
const verification = {
  recaptcha_v2: {
    url: 'https://www.google.com/recaptcha/api/siteverify',
    field: 'g-recaptcha-response',
    secret: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe',
  },
  turnstile: {
    url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    field: 'cf-turnstile-response',
    secret: '1x0000000000000000000000000000000AA',
  },
  hcaptcha: {
    url: 'https://api.hcaptcha.com/siteverify',
    field: 'h-captcha-response',
    secret: '0x0000000000000000000000000000000000000000',
  },
}

function verdict(accepted: boolean, codes: string[] = []): Response {
  const text = accepted ? 'ACCEPTED' : `REJECTED: ${codes.join(', ')}`
  return new Response(
    `<!doctype html><html lang="en" data-captcha-verdict="${accepted ? 'accepted' : 'rejected'}"><head><meta charset="utf-8"><title>CAPTCHA verdict</title></head><body>${Bun.escapeHTML(text)}</body></html>`,
    {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  )
}

async function handleDummyMfa(request: Request): Promise<Response> {
  if (request.method === 'GET')
    return new Response(
      await Bun.file(`${import.meta.dir}/pages/mfa-login.html`).text(),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  // Drain bounded chunks without parsing or retaining user-entered values.
  const reader = request.body?.getReader()
  let bytesRead = 0
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > MAX_DUMMY_MFA_BODY_BYTES) {
        await reader.cancel()
        return new Response('Request too large', {
          status: 413,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }
    }
  }
  return new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dummy login result</title></head><body><p role="status">STATUS: submitted</p></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

async function handleCaptchaSubmit(
  request: Request,
  page: (typeof FIXTURE_PAGES)[number],
  verifyUrls: Partial<Record<Vendor, string>> | undefined,
): Promise<Response> {
  if (page.family === 'none') return verdict(true)
  if (!(page.family in verification))
    return new Response('not found', { status: 404 })
  const vendor = page.family as Vendor
  const config = verification[vendor]
  try {
    const token = (await request.formData()).get(config.field)
    if (typeof token !== 'string' || !token.trim())
      return verdict(false, ['missing-input-response'])
    const secret =
      page.id === 'turnstile-block'
        ? '2x0000000000000000000000000000000AA'
        : config.secret
    const response = await fetch(verifyUrls?.[vendor] ?? config.url, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return verdict(false, ['verification-unavailable'])
    const result = (await response.json()) as {
      success?: unknown
      'error-codes'?: unknown
    }
    const codes = Array.isArray(result['error-codes'])
      ? result['error-codes'].filter(
          (code): code is string => typeof code === 'string',
        )
      : []
    return verdict(
      result.success === true,
      codes.length ? codes : ['verification-failed'],
    )
  } catch {
    return verdict(false, ['verification-unavailable'])
  }
}

export async function startCaptchaFixtureServer(
  options: {
    hostname?: string
    publicHost?: string
    publicFrameHost?: string
    port?: number
    framePort?: number
    verifyUrls?: Partial<Record<Vendor, string>>
  } = {},
): Promise<CaptchaFixtureServer> {
  const host = options.publicHost ?? '127.0.0.1'
  const frameHost =
    options.publicFrameHost ??
    (host === 'localhost' ? '127.0.0.1' : 'localhost')
  if (host.toLowerCase() === frameHost.toLowerCase())
    throw new Error('Fixture and frame hosts must be different sites')
  let frameOrigin = ''
  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/mfa-login.html')
      return request.method === 'GET'
        ? handleDummyMfa(request)
        : new Response('not found', { status: 404 })
    if (request.method === 'GET') {
      if (pathname === '/healthz') return new Response('ok')
      if (
        [...FIXTURE_PAGES, ...SPOTTING_PAGES].some(
          (page) => page.path === pathname,
        )
      ) {
        const html = await Bun.file(
          `${import.meta.dir}/pages${pathname}`,
        ).text()
        return new Response(
          html.replaceAll('{{FRAME_ORIGIN}}', Bun.escapeHTML(frameOrigin)),
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        )
      }
    }
    if (pathname === '/submit/mfa-login' && request.method === 'POST')
      return handleDummyMfa(request)
    const page = FIXTURE_PAGES.find((page) => pathname === `/submit/${page.id}`)
    if (request.method !== 'POST' || !page)
      return new Response('not found', { status: 404 })
    return handleCaptchaSubmit(request, page, options.verifyUrls)
  }
  function listen(port?: number) {
    let lastError: unknown
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        return Bun.serve({
          hostname: options.hostname ?? '127.0.0.1',
          port: port ?? 10101 + Math.floor(Math.random() * 10102),
          fetch: handle,
        })
      } catch (error) {
        if (port !== undefined) throw error
        lastError = error
      }
    }
    throw new Error(`Could not bind a CAPTCHA fixture port: ${lastError}`)
  }
  const server = listen(options.port)
  try {
    const frameServer = listen(options.framePort)
    const address = (name: string, port: number | undefined) =>
      `http://${name.includes(':') && !name.startsWith('[') ? `[${name}]` : name}:${port}`
    const origin = address(host, server.port)
    frameOrigin = address(frameHost, frameServer.port)
    return {
      origin,
      frameOrigin,
      url: (path) => `${origin}${path.startsWith('/') ? path : `/${path}`}`,
      stop: async () => {
        await Promise.all([server.stop(true), frameServer.stop(true)])
      },
    }
  } catch (error) {
    await server.stop(true)
    throw error
  }
}
