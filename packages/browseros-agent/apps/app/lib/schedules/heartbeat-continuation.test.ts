import { describe, expect, test } from 'bun:test'
import { mayContinueHeartbeat } from './heartbeat-continuation'

describe('heartbeat continuation policy', () => {
  test('allows the first run and continuation after a completed run', () => {
    expect(mayContinueHeartbeat()).toBe(true)
    expect(mayContinueHeartbeat('completed')).toBe(true)
  })

  test('fails closed after a running or failed run to avoid replaying uncertain tools', () => {
    expect(mayContinueHeartbeat('running')).toBe(false)
    expect(mayContinueHeartbeat('failed')).toBe(false)
  })
})
