import { describe, expect, it } from 'bun:test'
import {
  detectHumanChallenge,
  type HumanChallengeSignal,
} from '../../src/agent/human-challenge-detector'

const baseSignal: HumanChallengeSignal = {
  urlOrigin: 'https://accounts.example.test',
  urlPath: '/signin',
  visiblePasswordInputCount: 0,
  visibleOtpInputCount: 0,
  captchaIframeCount: 0,
  captchaProviderMarkerCount: 0,
  explicitChallengeState: 'none',
  formState: 'none',
}

describe('human challenge detector contract', () => {
  it('classifies a CAPTCHA only when explicit state and independent markers agree', () => {
    expect(
      detectHumanChallenge({
        ...baseSignal,
        urlPath: '/captcha',
        captchaIframeCount: 1,
        captchaProviderMarkerCount: 1,
        explicitChallengeState: 'captcha',
        formState: 'challenge',
      }),
    ).toEqual({ kind: 'captcha', reason: 'captcha_signals_agree' })
  })

  it('classifies MFA only when explicit state, visible OTP, and challenge form agree', () => {
    expect(
      detectHumanChallenge({
        ...baseSignal,
        visibleOtpInputCount: 1,
        explicitChallengeState: 'mfa',
        formState: 'challenge',
      }),
    ).toEqual({ kind: 'mfa', reason: 'mfa_signals_agree' })
  })

  it('does not classify URL hints, ordinary login, or consent as a challenge', () => {
    for (const signal of [
      { ...baseSignal, urlPath: '/captcha' },
      { ...baseSignal, visiblePasswordInputCount: 1, formState: 'login' },
      { ...baseSignal, formState: 'consent' },
      {
        ...baseSignal,
        captchaIframeCount: 1,
        captchaProviderMarkerCount: 1,
        explicitChallengeState: 'unknown',
      },
    ]) {
      expect(detectHumanChallenge(signal)).toEqual({
        kind: 'ambiguous',
        reason: 'insufficient_signal',
      })
    }
  })

  it('does not treat hidden or absent OTP fields as visible MFA evidence', () => {
    expect(
      detectHumanChallenge({
        ...baseSignal,
        visibleOtpInputCount: 0,
        explicitChallengeState: 'mfa',
        formState: 'challenge',
      }).kind,
    ).toBe('ambiguous')
  })

  it('returns ambiguous when CAPTCHA and MFA evidence conflict', () => {
    expect(
      detectHumanChallenge({
        ...baseSignal,
        visibleOtpInputCount: 1,
        captchaIframeCount: 1,
        captchaProviderMarkerCount: 1,
        explicitChallengeState: 'captcha',
        formState: 'challenge',
      }),
    ).toEqual({ kind: 'ambiguous', reason: 'conflicting_signals' })
  })

  it('fails closed for malformed, extra, and oversized signals', () => {
    const oversized = 'x'.repeat(513)
    for (const value of [
      null,
      [],
      { ...baseSignal, unexpectedText: 'secret page text' },
      { ...baseSignal, urlPath: oversized },
      { ...baseSignal, visibleOtpInputCount: 21 },
      { ...baseSignal, captchaIframeCount: 1.5 },
      { ...baseSignal, urlOrigin: 'https://user:password@example.test' },
      { ...baseSignal, urlPath: '/verify?code=secret' },
    ]) {
      expect(detectHumanChallenge(value)).toEqual({
        kind: 'ambiguous',
        reason: 'invalid_signal',
      })
    }
  })

  it('returns only fixed reason codes and never echoes sensitive input', () => {
    const secret = 'otp-secret-493812'
    const result = detectHumanChallenge({
      ...baseSignal,
      urlPath: `/challenge/${secret}`,
      visibleOtpInputCount: 1,
      explicitChallengeState: 'mfa',
      formState: 'challenge',
      pageText: secret,
    })
    expect(result).toEqual({ kind: 'ambiguous', reason: 'invalid_signal' })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain('/challenge')
  })
})
