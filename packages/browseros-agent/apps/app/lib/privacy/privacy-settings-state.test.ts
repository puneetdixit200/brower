import { expect, it } from 'bun:test'
import {
  getPrivacySettingsMessage,
  initialPrivacySettingsState,
  reducePrivacySettingsState,
} from './privacy-settings-state'

const enabledConsent = {
  enabled: true,
  revision: '22222222-2222-4222-8222-222222222222',
}

it('shows a retryable local-service error in a normal window when consent is offline', () => {
  const loading = reducePrivacySettingsState(initialPrivacySettingsState, {
    type: 'load-start',
    request: 1,
  })
  const failed = reducePrivacySettingsState(loading, {
    type: 'load-failure',
    request: 1,
    message: 'Local service unavailable',
  })

  expect(failed).toMatchObject({
    ready: true,
    error: 'Local service unavailable',
  })
  expect(
    getPrivacySettingsMessage({ incognito: false, profileEnabled: false }),
  ).toBeNull()
})

it('recovers the canonical profile choice and effective grant on retry', () => {
  const loading = reducePrivacySettingsState(initialPrivacySettingsState, {
    type: 'load-start',
    request: 1,
  })
  const failed = reducePrivacySettingsState(loading, {
    type: 'load-failure',
    request: 1,
    message: 'Local service unavailable',
  })
  const retry = reducePrivacySettingsState(failed, {
    type: 'load-start',
    request: 2,
  })
  const recovered = reducePrivacySettingsState(retry, {
    type: 'load-success',
    request: 2,
    consent: enabledConsent,
    appGrantEnabled: true,
  })

  expect(recovered).toMatchObject({
    profileEnabled: true,
    appGrantEnabled: true,
    ready: true,
    error: null,
  })
})

it('keeps the canonical profile enabled after a failed revoke while app sending stays off', () => {
  const state = reducePrivacySettingsState(initialPrivacySettingsState, {
    type: 'mutation-success',
    consent: enabledConsent,
  })
  const revokePending = reducePrivacySettingsState(state, {
    type: 'mutation-start',
    enabled: false,
  })
  const failedRead = reducePrivacySettingsState(revokePending, {
    type: 'consent-event',
    consent: null,
    source: 'refresh',
  })

  expect(failedRead).toMatchObject({
    profileEnabled: true,
    appGrantEnabled: false,
  })
  expect(
    getPrivacySettingsMessage({ incognito: true, profileEnabled: true }),
  ).toContain('Profile-wide agent diagnostics are enabled')
})

it('does not let a pre-revoke read overwrite a cross-context revoke', () => {
  const loading = reducePrivacySettingsState(initialPrivacySettingsState, {
    type: 'load-start',
    request: 1,
  })
  const revoked = reducePrivacySettingsState(loading, {
    type: 'consent-event',
    consent: null,
    source: 'external-revoke',
  })
  const staleResponse = reducePrivacySettingsState(revoked, {
    type: 'load-success',
    request: 1,
    consent: enabledConsent,
    appGrantEnabled: true,
  })

  expect(staleResponse).toMatchObject({
    profileEnabled: false,
    appGrantEnabled: false,
    ready: false,
    loadGeneration: 2,
  })
})
