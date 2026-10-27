import { expect, it, mock } from 'bun:test'

let revision = '11111111-1111-4111-8111-111111111111'
let allowed = false
let privateWindow = false
let serverEnabled = false
let delayWindowCheck = false
let releaseWindowCheck: (() => void) | undefined
let notifyWindowCheck: (() => void) | undefined
let holdFetch = false
let startedFetch: ((signal: AbortSignal) => void) | undefined
let callback:
  | ((consent: { enabled: boolean; revision: string } | null) => void)
  | undefined
const init = mock((_options: Record<string, unknown>) => {})
const close = mock(async () => true)
const outbound: Array<{
  body: string
  signal: AbortSignal | null
  redirect: RequestRedirect | undefined
}> = []
mock.module('@sentry/react', () => ({
  init,
  close,
  reactErrorHandler: () => () => {},
}))
mock.module('../browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://127.0.0.1:9105',
}))
mock.module('../browseros/incognito', () => ({
  isIncognitoWindow: async () => {
    if (delayWindowCheck) {
      notifyWindowCheck?.()
      await new Promise<void>((resolve) => {
        releaseWindowCheck = resolve
      })
      delayWindowCheck = false
    }
    return privateWindow
  },
}))
mock.module('../env', () => ({
  env: { VITE_PUBLIC_SENTRY_DSN: 'https://sentry.example/1', PROD: false },
}))
mock.module('../privacy/telemetry-consent', () => ({
  refreshTelemetryConsent: async () => ({ enabled: serverEnabled, revision }),
  hasCurrentTelemetryGrant: async (requested: string) =>
    allowed && requested === revision,
  subscribeTelemetryConsent: (listener: typeof callback) => {
    callback = listener
    return () => {}
  },
}))

globalThis.chrome = {
  runtime: { getManifest: () => ({ version: 'test-version' }) },
} as unknown as typeof chrome
globalThis.fetch = mock(
  async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal | null
    outbound.push({
      body: String(init?.body ?? ''),
      signal,
      redirect: init?.redirect,
    })
    if (holdFetch && signal) {
      startedFetch?.(signal)
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
    }
    return new Response(null, { status: 200 })
  },
) as unknown as typeof fetch

it('starts off, initializes only after consent in a normal context, sanitizes, and rejects stale revisions', async () => {
  await import('./sentry')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(init).not.toHaveBeenCalled()

  privateWindow = true
  serverEnabled = true
  callback?.({ enabled: true, revision })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(init).not.toHaveBeenCalled()

  privateWindow = false
  allowed = true
  callback?.({ enabled: true, revision })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(init).toHaveBeenCalledTimes(1)
  const options = init.mock.calls[0]?.[0]
  expect(options?.sendDefaultPii).toBe(false)
  const beforeSend = options?.beforeSend as
    | ((event: unknown) => unknown)
    | undefined
  const event = beforeSend?.({
    message: 'private prompt sentinel',
    user: { email: 'private@example.test' },
    request: { url: 'https://private.example/path' },
    tags: { secret: 'private tag' },
    extra: { response: 'private response sentinel' },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'private exception text',
          stacktrace: {
            frames: [
              {
                filename: '/private/path',
                lineno: 9,
                vars: { prompt: 'secret' },
              },
            ],
          },
        },
      ],
    },
  })
  expect(JSON.stringify(event)).not.toContain('private')

  const makeTransport = options?.transport as (transportOptions: {
    url: string
  }) => { send: (envelope: unknown) => Promise<unknown> }
  const transport = makeTransport({
    url: 'https://sentry.example/api/1/envelope/',
  })
  const payload = {
    message: 'private response sentinel',
    extra: { prompt: 'private prompt sentinel' },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'private exception text',
          stacktrace: {
            frames: [
              {
                filename: '/private/path',
                lineno: 9,
                vars: { prompt: 'secret' },
              },
            ],
          },
        },
      ],
    },
  }
  await transport.send([
    {
      event_id: 'abcdef0123456789',
      sent_at: '2026-10-28T00:00:00Z',
      telemetry_revision: revision,
    },
    [[{ type: 'event', event_id: 'abcdef0123456789' }, payload]],
  ])
  expect(outbound).toHaveLength(1)
  expect(outbound[0]?.body).not.toContain('private')
  expect(outbound[0]?.body).not.toContain('telemetry_revision')
  expect(outbound[0]?.redirect).toBe('error')
  await transport.send([
    { event_id: 'abcdef0123456789' },
    [[{ type: 'event' }, payload]],
  ])
  expect(outbound).toHaveLength(2)
  const foreignTransport = makeTransport({
    url: 'https://other.example/api/1/envelope/',
  })
  await foreignTransport.send([
    { event_id: 'abcdef0123456789' },
    [[{ type: 'event' }, payload]],
  ])
  expect(outbound).toHaveLength(2)

  callback?.(null)
  serverEnabled = false
  revision = '22222222-2222-4222-8222-222222222222'
  serverEnabled = true
  callback?.({ enabled: true, revision })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(init).toHaveBeenCalledTimes(2)
  const nextOptions = init.mock.calls[1]?.[0]
  const nextTransportFactory = nextOptions?.transport as (transportOptions: {
    url: string
  }) => { send: (envelope: unknown) => Promise<unknown> }
  const staleTransport = makeTransport({
    url: 'https://sentry.example/api/1/envelope/',
  })
  await staleTransport.send([
    { event_id: 'abcdef0123456789' },
    [[{ type: 'event' }, { message: 'must not go' }]],
  ])
  expect(outbound).toHaveLength(2)

  const currentTransport = nextTransportFactory({
    url: 'https://sentry.example/api/1/envelope/',
  })
  holdFetch = true
  const signalReady = new Promise<AbortSignal>((resolve) => {
    startedFetch = resolve
  })
  const pendingSend = currentTransport.send([
    { event_id: 'abcdef0123456789' },
    [[{ type: 'event' }, payload]],
  ])
  const signal = await signalReady
  callback?.(null)
  await pendingSend
  expect(signal.aborted).toBe(true)

  callback?.(null)
  serverEnabled = false
  revision = '33333333-3333-4333-8333-333333333333'
  delayWindowCheck = true
  const windowCheckStarted = new Promise<void>((resolve) => {
    notifyWindowCheck = resolve
  })
  serverEnabled = true
  callback?.({ enabled: true, revision })
  await windowCheckStarted
  callback?.(null)
  serverEnabled = false
  revision = '44444444-4444-4444-8444-444444444444'
  serverEnabled = true
  callback?.({ enabled: true, revision })
  releaseWindowCheck?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(init).toHaveBeenCalledTimes(3)
})
