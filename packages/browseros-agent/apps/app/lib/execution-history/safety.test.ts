import { describe, expect, it } from 'bun:test'
import { containsCredentialShapedText } from './safety'

describe('containsCredentialShapedText', () => {
  it('continues to recognize the previously supported credential shapes', () => {
    for (const credential of [
      '-----BEGIN PRIVATE KEY-----',
      'password=fixture-secret',
      'passwd: fixture-secret',
      'api_key: fixture-secret',
      'secret_key=fixture-secret',
      'access_token: fixture-secret',
      `Bearer ${'a'.repeat(20)}`,
      `eyJ${'a'.repeat(8)}.${'b'.repeat(12)}.${'c'.repeat(12)}`,
      `xoxb-${'a'.repeat(20)}`,
      `xapp-${'a'.repeat(20)}`,
      `sk-${'a'.repeat(24)}`,
      `github_pat_${'a'.repeat(50)}`,
      `ghp_${'a'.repeat(30)}`,
      `AKIA${'A'.repeat(16)}`,
    ]) {
      expect(containsCredentialShapedText(credential)).toBe(true)
    }
  })

  it('recognizes additional provider-specific secret formats', () => {
    for (const credential of [
      `AIza${'A'.repeat(35)}`,
      `npm_${'a'.repeat(36)}`,
      `sk_live_${'a'.repeat(24)}`,
      `sk_test_${'b'.repeat(24)}`,
      `rk_live_${'c'.repeat(24)}`,
      `SG.${'d'.repeat(22)}.${'e'.repeat(43)}`,
    ]) {
      expect(containsCredentialShapedText(`credential: ${credential}`)).toBe(
        true,
      )
    }
  })

  it('leaves benign public keys and near-miss strings alone', () => {
    for (const text of [
      `AIza${'A'.repeat(34)}`,
      `npm_${'a'.repeat(35)}`,
      `sk_live_${'a'.repeat(19)}`,
      `rk_public_${'c'.repeat(24)}`,
      `pk_live_${'p'.repeat(24)}`,
      `SG.${'d'.repeat(19)}.${'e'.repeat(43)}`,
      'A normal deployment uses the Google Maps API.',
    ]) {
      expect(containsCredentialShapedText(text)).toBe(false)
    }
  })
})
