import type { ConsentChangeSource, TelemetryConsent } from './telemetry-consent'

export interface PrivacySettingsState {
  profileEnabled: boolean
  appGrantEnabled: boolean
  ready: boolean
  error: string | null
  loadGeneration: number
}

export const initialPrivacySettingsState: PrivacySettingsState = {
  profileEnabled: false,
  appGrantEnabled: false,
  ready: false,
  error: null,
  loadGeneration: 0,
}

export type PrivacySettingsAction =
  | { type: 'load-start'; request: number }
  | { type: 'mutation-start'; enabled: boolean }
  | {
      type: 'load-success'
      request: number
      consent: TelemetryConsent
      appGrantEnabled: boolean
    }
  | { type: 'load-failure'; request: number; message: string }
  | {
      type: 'consent-event'
      consent: TelemetryConsent | null
      source: ConsentChangeSource
    }
  | { type: 'mutation-success'; consent: TelemetryConsent }
  | { type: 'clear-error' }

export function reducePrivacySettingsState(
  state: PrivacySettingsState,
  action: PrivacySettingsAction,
): PrivacySettingsState {
  switch (action.type) {
    case 'load-start':
      return { ...state, error: null, loadGeneration: action.request }
    case 'mutation-start':
      return {
        ...state,
        appGrantEnabled: action.enabled && state.appGrantEnabled,
        error: null,
      }
    case 'load-success':
      if (action.request !== state.loadGeneration) return state
      return {
        ...state,
        profileEnabled: action.consent.enabled,
        appGrantEnabled: action.appGrantEnabled,
        ready: true,
        error: null,
      }
    case 'mutation-success':
      return {
        ...state,
        profileEnabled: action.consent.enabled,
        appGrantEnabled: action.consent.enabled,
        ready: true,
        error: null,
      }
    case 'load-failure':
      if (action.request !== state.loadGeneration) return state
      return { ...state, ready: true, error: action.message }
    case 'consent-event':
      if (action.source === 'external-revoke') {
        return {
          ...state,
          appGrantEnabled: false,
          ready: false,
          error: null,
          loadGeneration: state.loadGeneration + 1,
        }
      }
      // Refresh failures and local invalidations clear the effective grant,
      // but do not claim that the canonical profile preference is off.
      if (action.source === 'refresh' || action.source === 'mutation') {
        return {
          ...state,
          appGrantEnabled: Boolean(action.consent?.enabled),
          ...(action.consent
            ? { profileEnabled: action.consent.enabled, ready: true }
            : {}),
        }
      }
      return state
    case 'clear-error':
      return { ...state, error: null }
  }
}

export function getPrivacySettingsMessage(input: {
  incognito: boolean
  profileEnabled: boolean
}) {
  if (input.incognito) {
    return `App error reporting is disabled in incognito. Profile-wide agent diagnostics are ${input.profileEnabled ? 'enabled' : 'off'}.`
  }
  return null
}
