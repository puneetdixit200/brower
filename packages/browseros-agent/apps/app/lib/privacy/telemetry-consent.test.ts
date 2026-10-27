import { beforeEach, expect, it, mock } from 'bun:test'
import {
  initialPrivacySettingsState,
  reducePrivacySettingsState,
} from './privacy-settings-state'

let serverEnabled = false
let revision = '11111111-1111-4111-8111-111111111111'
const calls: Array<{ url: string; init?: RequestInit }> = []
let failRead = false
let failUpdate = false
let delayGrant = false
let releaseGrant: (() => void) | undefined
let holdGrantStorageWrite = false
let releaseStorageWrite: (() => void) | undefined
let storageWriteEntered: (() => void) | undefined
let storageWriteEnteredPromise: Promise<void>
let changedListener:
  | ((changes: Record<string, { newValue?: unknown }>, area: string) => void)
  | undefined

mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://127.0.0.1:9105',
}))

globalThis.chrome = {
  storage: {
    local: {
      set: async (values: Record<string, unknown>) => {
        const consent = values.telemetryConsent as
          | { enabled?: boolean; revision?: string }
          | undefined
        if (holdGrantStorageWrite && consent?.enabled === true) {
          storageWriteEntered?.()
          await new Promise<void>((resolve) => {
            releaseStorageWrite = resolve
          })
          holdGrantStorageWrite = false
        }
      },
    },
    onChanged: {
      addListener: (listener: typeof changedListener) => {
        changedListener = listener
      },
    },
  },
} as unknown as typeof chrome

globalThis.fetch = mock(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/privacy/telemetry/state')) {
      if (failRead) throw new Error('offline')
      return Response.json({ enabled: serverEnabled, revision })
    }
    if (url.endsWith('/privacy/telemetry') && init?.method === 'PUT') {
      if (failUpdate) return new Response(null, { status: 503 })
      const body = JSON.parse(String(init.body)) as { enabled: boolean }
      if (body.enabled && delayGrant) {
        await new Promise<void>((resolve) => {
          releaseGrant = resolve
        })
        delayGrant = false
      }
      serverEnabled = body.enabled
      revision = '22222222-2222-4222-8222-222222222222'
      return Response.json({ enabled: serverEnabled, revision })
    }
    return new Response(null, { status: 404 })
  },
) as unknown as typeof fetch

const {
  refreshTelemetryConsent,
  setTelemetryConsent,
  subscribeTelemetryConsent,
  hasEffectiveTelemetryConsent,
} = await import('./telemetry-consent')
subscribeTelemetryConsent(() => {})

beforeEach(() => {
  calls.length = 0
  serverEnabled = false
  revision = '11111111-1111-4111-8111-111111111111'
  failRead = false
  failUpdate = false
  delayGrant = false
  releaseGrant = undefined
  holdGrantStorageWrite = false
  releaseStorageWrite = undefined
  storageWriteEntered = undefined
  storageWriteEnteredPromise = new Promise<void>((resolve) => {
    storageWriteEntered = resolve
  })
})

it('reads canonical consent with a bodyless POST and fails closed on offline state', async () => {
  expect(await refreshTelemetryConsent()).toMatchObject({ enabled: false })
  expect(calls[0]?.init?.method).toBe('POST')
  expect(calls[0]?.init?.body).toBeUndefined()
  failRead = true
  await expect(refreshTelemetryConsent()).rejects.toThrow('offline')
})

it('persists an exact consent body through the server and can read it again', async () => {
  const saved = await setTelemetryConsent(true)
  expect(saved).toMatchObject({
    enabled: true,
    revision: '22222222-2222-4222-8222-222222222222',
  })
  expect(calls[0]?.init?.method).toBe('PUT')
  expect(calls[0]?.init?.body).toBe('{"enabled":true}')
  expect(await refreshTelemetryConsent()).toMatchObject({
    enabled: true,
    revision: saved.revision,
  })
})

it('keeps effective app consent off when a revoke fails despite profile consent remaining on', async () => {
  serverEnabled = true
  await refreshTelemetryConsent()
  failUpdate = true

  await expect(setTelemetryConsent(false)).rejects.toThrow('503')
  const canonical = await refreshTelemetryConsent()

  expect(canonical.enabled).toBe(true)
  expect(hasEffectiveTelemetryConsent()).toBe(false)
})

it('serializes a delayed opt-in before a later revoke and leaves canonical state off', async () => {
  delayGrant = true
  const optIn = setTelemetryConsent(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const revoke = setTelemetryConsent(false)
  releaseGrant?.()
  await expect(optIn).rejects.toThrow('superseded')
  await expect(revoke).resolves.toMatchObject({ enabled: false })
  expect(serverEnabled).toBe(false)
  expect(
    calls
      .filter((call) => call.init?.method === 'PUT')
      .map((call) => call.init?.body),
  ).toEqual(['{"enabled":true}', '{"enabled":false}'])
})

it('rejects an opt-in superseded by a cross-context revoke during local persistence', async () => {
  holdGrantStorageWrite = true
  const optIn = setTelemetryConsent(true)
  await storageWriteEnteredPromise
  serverEnabled = false
  revision = '33333333-3333-4333-8333-333333333333'
  changedListener?.(
    {
      telemetryConsent: {
        newValue: { enabled: false, revision },
      },
    },
    'local',
  )
  releaseStorageWrite?.()
  await expect(optIn).rejects.toThrow('superseded')
})

it('treats another context’s pending revoke as a hint and displays canonical results', async () => {
  const enabled = await setTelemetryConsent(true)
  let state = reducePrivacySettingsState(initialPrivacySettingsState, {
    type: 'mutation-success',
    consent: enabled,
  })
  let request = 0
  let pending: Promise<void> | undefined
  const unsubscribe = subscribeTelemetryConsent(
    (consent, source = 'snapshot') => {
      state = reducePrivacySettingsState(state, {
        type: 'consent-event',
        consent,
        source,
      })
      if (source !== 'external-revoke') return
      const id = ++request
      state = reducePrivacySettingsState(state, {
        type: 'load-start',
        request: id,
      })
      pending = refreshTelemetryConsent().then(
        (canonical) => {
          state = reducePrivacySettingsState(state, {
            type: 'load-success',
            request: id,
            consent: canonical,
            appGrantEnabled: hasEffectiveTelemetryConsent(),
          })
        },
        () => {
          state = reducePrivacySettingsState(state, {
            type: 'load-failure',
            request: id,
            message: 'offline',
          })
        },
      )
    },
  )

  // Another tab has broadcast its intent, but its PUT has not succeeded.
  changedListener?.(
    {
      telemetryConsent: {
        newValue: { enabled: false, revision: enabled.revision },
      },
    },
    'local',
  )
  expect(state).toMatchObject({
    profileEnabled: true,
    appGrantEnabled: false,
    ready: false,
  })
  await pending
  expect(state).toMatchObject({
    profileEnabled: true,
    appGrantEnabled: false,
    ready: true,
    error: null,
  })
  expect(hasEffectiveTelemetryConsent()).toBe(false)

  // The later confirmed revoke carries a new revision and is read canonically.
  serverEnabled = false
  revision = '44444444-4444-4444-8444-444444444444'
  changedListener?.(
    { telemetryConsent: { newValue: { enabled: false, revision } } },
    'local',
  )
  await pending
  expect(state).toMatchObject({
    profileEnabled: false,
    appGrantEnabled: false,
    ready: true,
    error: null,
  })
  unsubscribe()
})

it('reports a failed canonical read after a cross-context revoke hint', async () => {
  const enabled = await setTelemetryConsent(true)
  let state = reducePrivacySettingsState(initialPrivacySettingsState, {
    type: 'mutation-success',
    consent: enabled,
  })
  let pending: Promise<void> | undefined
  const unsubscribe = subscribeTelemetryConsent(
    (consent, source = 'snapshot') => {
      state = reducePrivacySettingsState(state, {
        type: 'consent-event',
        consent,
        source,
      })
      if (source !== 'external-revoke') return
      state = reducePrivacySettingsState(state, {
        type: 'load-start',
        request: 1,
      })
      pending = refreshTelemetryConsent().then(
        () => {},
        () => {
          state = reducePrivacySettingsState(state, {
            type: 'load-failure',
            request: 1,
            message: 'offline',
          })
        },
      )
    },
  )
  failRead = true
  changedListener?.(
    {
      telemetryConsent: {
        newValue: { enabled: false, revision: enabled.revision },
      },
    },
    'local',
  )
  await pending
  expect(state).toMatchObject({
    profileEnabled: true,
    appGrantEnabled: false,
    error: 'offline',
  })
  expect(hasEffectiveTelemetryConsent()).toBe(false)
  unsubscribe()
})
