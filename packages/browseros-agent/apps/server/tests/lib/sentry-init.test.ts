import { afterEach, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initializeTelemetryConsent,
  resetTelemetryConsentForTesting,
  setTelemetryConsent,
} from '../../src/lib/privacy/telemetry-consent'

const init = mock((_options: Record<string, unknown>) => {})
const captureException = mock((_error: unknown) => 'event-id')
const currentScope = { setTag: mock(() => {}) }
mock.module('@sentry/bun', () => ({
  init,
  captureException,
  close: mock(async () => true),
  setUser: mock(() => {}),
  setContext: mock(() => {}),
  getCurrentScope: mock(() => currentScope),
  withScope: mock((callback: (scope: typeof currentScope) => void) =>
    callback(currentScope),
  ),
}))
mock.module('../../src/env', () => ({
  INLINED_ENV: {
    SENTRY_DSN: 'https://sentry.example/1',
    POSTHOG_API_KEY: 'phc-test-key',
  },
}))
mock.module('../../src/version', () => ({ VERSION: 'test-version' }))

let stateDirectory = ''
afterEach(async () => {
  resetTelemetryConsentForTesting()
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true })
  stateDirectory = ''
  init.mockClear()
  captureException.mockClear()
})

it('does not initialize or capture with keys present and default consent off', async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), 'sentry-consent-'))
  await initializeTelemetryConsent(stateDirectory)
  const { Sentry } = await import('../../src/lib/sentry')
  Sentry.captureException(new Error('PROMPT_SENTINEL'))
  expect(init).not.toHaveBeenCalled()
  expect(captureException).not.toHaveBeenCalled()
})

it('initializes after consent, disables default PII and shapes accepted events safely', async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), 'sentry-consent-'))
  await initializeTelemetryConsent(stateDirectory)
  const consent = await setTelemetryConsent(true)
  const { Sentry, disableTelemetrySentry, enableTelemetrySentry } =
    await import('../../src/lib/sentry')
  enableTelemetrySentry(consent.revision)
  Sentry.captureException(new Error('PROMPT_SENTINEL'))
  expect(init).toHaveBeenCalledTimes(1)
  const options = init.mock.calls[0]?.[0]
  expect(options?.sendDefaultPii).toBe(false)
  const beforeSend = options?.beforeSend as
    | ((event: unknown) => unknown)
    | undefined
  const accepted = beforeSend?.({
    event_id: '0123456789abcdef0123456789abcdef',
    message: 'PROMPT_SENTINEL',
    exception: { values: [{ type: 'Error', value: 'PASSWORD_SENTINEL' }] },
    extra: { apiKey: 'sk-test-credential' },
  })
  const serialized = JSON.stringify(accepted)
  for (const secret of [
    'PROMPT_SENTINEL',
    'PASSWORD_SENTINEL',
    'sk-test-credential',
  ]) {
    expect(serialized).not.toContain(secret)
  }
  expect(captureException).toHaveBeenCalledTimes(1)

  await disableTelemetrySentry()
  const renewedConsent = await setTelemetryConsent(true)
  enableTelemetrySentry(renewedConsent.revision)
  expect(init).toHaveBeenCalledTimes(2)
})
