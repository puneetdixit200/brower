import { describe, expect, test } from 'bun:test'
import { resolveHomeSearchUrl } from './home-search'

describe('resolveHomeSearchUrl', () => {
  test('returns null for an empty query', () => {
    expect(resolveHomeSearchUrl('  ')).toBeNull()
  })

  test('opens explicit HTTP and HTTPS URLs', () => {
    expect(resolveHomeSearchUrl('https://example.com/a')).toBe(
      'https://example.com/a',
    )
    expect(resolveHomeSearchUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/',
    )
  })

  test('navigates bare hostnames over HTTPS', () => {
    expect(resolveHomeSearchUrl('example.com/docs')).toBe(
      'https://example.com/docs',
    )
  })

  test('handles local development addresses', () => {
    expect(resolveHomeSearchUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(resolveHomeSearchUrl('127.0.0.1:5173')).toBe('http://127.0.0.1:5173')
  })

  test('searches ordinary text and encodes it', () => {
    expect(resolveHomeSearchUrl('aster browser features')).toBe(
      'https://www.google.com/search?q=aster%20browser%20features',
    )
  })

  test('never navigates to a non-web scheme', () => {
    expect(resolveHomeSearchUrl('javascript:alert(1)')).toContain(
      'google.com/search?',
    )
    expect(resolveHomeSearchUrl('file:///etc/passwd')).toContain(
      'google.com/search?',
    )
  })
})
