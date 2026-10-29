/**
 * Conservative classification contract for renderer supplied challenge signals.
 * This module intentionally never accepts page text, input values, or full URLs.
 */
export type HumanChallengeKind = 'captcha' | 'mfa' | 'ambiguous'

export type HumanChallengeReason =
  | 'captcha_signals_agree'
  | 'mfa_signals_agree'
  | 'insufficient_signal'
  | 'conflicting_signals'
  | 'invalid_signal'

export type HumanChallengeResult = {
  kind: HumanChallengeKind
  reason: HumanChallengeReason
}

export type HumanChallengeSignal = {
  urlOrigin: string
  urlPath: string
  visiblePasswordInputCount: number
  visibleOtpInputCount: number
  captchaIframeCount: number
  captchaProviderMarkerCount: number
  explicitChallengeState: 'none' | 'captcha' | 'mfa' | 'unknown'
  formState: 'none' | 'login' | 'consent' | 'challenge' | 'unknown'
}

const MAX_ORIGIN_LENGTH = 255
const MAX_PATH_LENGTH = 512
const MAX_SIGNAL_KEYS = 8
const MAX_INPUT_COUNT = 20
const SIGNAL_KEYS = new Set<keyof HumanChallengeSignal>([
  'urlOrigin',
  'urlPath',
  'visiblePasswordInputCount',
  'visibleOtpInputCount',
  'captchaIframeCount',
  'captchaProviderMarkerCount',
  'explicitChallengeState',
  'formState',
])
const CHALLENGE_STATES = new Set(['none', 'captcha', 'mfa', 'unknown'])
const FORM_STATES = new Set([
  'none',
  'login',
  'consent',
  'challenge',
  'unknown',
])

const ambiguous = (reason: HumanChallengeReason): HumanChallengeResult => ({
  kind: 'ambiguous',
  reason,
})

/** Accepts only bounded, allowlisted metadata and emits a secret-free enum. */
export function detectHumanChallenge(input: unknown): HumanChallengeResult {
  if (!isBoundedSignal(input)) return ambiguous('invalid_signal')

  const hasCaptchaMarkers =
    input.captchaIframeCount > 0 && input.captchaProviderMarkerCount > 0
  const hasMfaMarkers =
    input.visibleOtpInputCount > 0 && input.formState === 'challenge'

  if (
    hasCaptchaMarkers &&
    hasMfaMarkers &&
    input.explicitChallengeState !== 'unknown'
  ) {
    return ambiguous('conflicting_signals')
  }

  if (
    input.explicitChallengeState === 'captcha' &&
    hasCaptchaMarkers &&
    input.visibleOtpInputCount === 0
  ) {
    return { kind: 'captcha', reason: 'captcha_signals_agree' }
  }

  if (
    input.explicitChallengeState === 'mfa' &&
    hasMfaMarkers &&
    input.captchaIframeCount === 0 &&
    input.captchaProviderMarkerCount === 0
  ) {
    return { kind: 'mfa', reason: 'mfa_signals_agree' }
  }

  return ambiguous('insufficient_signal')
}

function isBoundedSignal(value: unknown): value is HumanChallengeSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== MAX_SIGNAL_KEYS ||
    keys.some((key) => !SIGNAL_KEYS.has(key as keyof HumanChallengeSignal))
  ) {
    return false
  }

  return (
    isSafeOrigin(record.urlOrigin) &&
    isSafePath(record.urlPath) &&
    isBoundedCount(record.visiblePasswordInputCount) &&
    isBoundedCount(record.visibleOtpInputCount) &&
    isBoundedCount(record.captchaIframeCount) &&
    isBoundedCount(record.captchaProviderMarkerCount) &&
    typeof record.explicitChallengeState === 'string' &&
    CHALLENGE_STATES.has(record.explicitChallengeState) &&
    typeof record.formState === 'string' &&
    FORM_STATES.has(record.formState)
  )
}

function isBoundedCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_INPUT_COUNT
  )
}

function isSafeOrigin(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ORIGIN_LENGTH
  ) {
    return false
  }
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

function isSafePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    !value.startsWith('/') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return false
  }
  return value.split('/').every((segment) => {
    if (
      segment.length > 64 ||
      /(?:token|secret|password|session|credential|auth)/i.test(segment)
    ) {
      return false
    }
    for (const character of segment) {
      const code = character.charCodeAt(0)
      if (code < 32 || code === 127) return false
    }
    return true
  })
}
