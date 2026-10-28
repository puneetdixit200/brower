import { describe, expect, test } from 'bun:test'
import { mayContinueHeartbeat } from './heartbeat-continuation'

describe('heartbeat continuation policy', () => {
  test('allows the first run and continuation after a completed run', () => {
    expect(mayContinueHeartbeat(undefined, undefined)).toBe(true)
    expect(mayContinueHeartbeat('completed', 'existing-conversation')).toBe(
      true,
    )
  })

  test('fails closed after a running or failed run to avoid replaying uncertain tools', () => {
    expect(mayContinueHeartbeat('running', 'existing-conversation')).toBe(false)
    expect(mayContinueHeartbeat('failed', 'existing-conversation')).toBe(false)
  })

  test('fails closed when an existing conversation has no run evidence', () => {
    expect(mayContinueHeartbeat(undefined, 'existing-conversation')).toBe(false)
  })

  test('fails closed for unknown run states', () => {
    expect(mayContinueHeartbeat('unknown', 'existing-conversation')).toBe(false)
  })
})
