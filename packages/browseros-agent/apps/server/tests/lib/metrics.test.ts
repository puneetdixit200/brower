/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initializeTelemetryConsent,
  resetTelemetryConsentForTesting,
  setTelemetryConsent,
} from '../../src/lib/privacy/telemetry-consent'

interface CaptureCall {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}
const captureCalls: CaptureCall[] = []
class FakePostHog {
  capture(call: CaptureCall) {
    captureCalls.push(call)
  }
  async shutdown() {}
}
mock.module('posthog-node', () => ({ PostHog: FakePostHog }))
mock.module('../../src/env', () => ({
  INLINED_ENV: { POSTHOG_API_KEY: 'phc-test-key' },
}))
const { metrics } = await import('../../src/lib/metrics')
let stateDirectory = ''
let revision = ''

async function enableConsent() {
  const state = await setTelemetryConsent(true)
  revision = state.revision
  metrics.enable(revision)
}

async function setup() {
  stateDirectory = await mkdtemp(join(tmpdir(), 'metrics-consent-'))
  const state = await initializeTelemetryConsent(stateDirectory)
  revision = state.revision
  metrics.initialize({ install_id: 'install-test' }, revision)
  captureCalls.length = 0
}

afterEach(async () => {
  await metrics.disable()
  resetTelemetryConsentForTesting()
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true })
  stateDirectory = ''
  revision = ''
  captureCalls.length = 0
})

it('creates no client or capture with keys present and default consent false', async () => {
  await setup()
  expect(metrics.isEnabled()).toBe(false)
  metrics.log('chat.request', { prompt: 'PROMPT_SENTINEL' }, 1)
  expect(captureCalls).toEqual([])
})

it('opt-in sends only an allowlisted content-free event', async () => {
  await setup()
  await enableConsent()
  expect(metrics.isEnabled()).toBe(true)
  metrics.log(
    'chat.request',
    {
      prompt: 'PROMPT_SENTINEL',
      response: 'RESPONSE_SENTINEL',
      comment: 'COMMENT_SENTINEL',
      token: 'sk-test-credential',
      provider: 'private-provider',
    },
    1,
  )

  expect(captureCalls).toHaveLength(1)
  const payload = JSON.stringify(captureCalls[0])
  for (const secret of [
    'PROMPT_SENTINEL',
    'RESPONSE_SENTINEL',
    'COMMENT_SENTINEL',
    'sk-test-credential',
    'private-provider',
  ])
    expect(payload).not.toContain(secret)
  expect(captureCalls[0]?.properties.install_id).toBe('install-test')
})

it('drops current and queued rollups on revoke and blocks later captures', async () => {
  await setup()
  await enableConsent()
  metrics.log('tool_executed', {
    success: true,
    tool_name: 'private-tool-name',
    source: 'private-source',
  })
  await setTelemetryConsent(false)
  await metrics.disable()
  metrics.log('chat.request', {}, 1)

  expect(captureCalls).toEqual([])
  expect(metrics.isEnabled()).toBe(false)
})
