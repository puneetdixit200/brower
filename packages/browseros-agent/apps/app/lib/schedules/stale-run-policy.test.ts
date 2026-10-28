import { describe, expect, it } from 'bun:test'
import { shouldFailStaleScheduledRun } from './stale-run-policy'

const now = Date.parse('2026-10-29T05:00:00.000Z')
const timeoutMs = 10 * 60 * 1000
const stale = {
  id: 'run-1',
  jobId: 'job-1',
  startedAt: '2026-10-29T04:40:00.000Z',
  status: 'running' as const,
}
const empty = new Set<string>()
const eligible = (
  overrides: Partial<Parameters<typeof shouldFailStaleScheduledRun>[0]> = {},
) => shouldFailStaleScheduledRun({
  run: stale,
  nowMs: now,
  timeoutMs,
  activeRunIds: empty,
  activeJobIds: empty,
  ...overrides,
})

describe('stale scheduled job cleanup', () => {
  it('fails only an orphaned running record older than the configured window', () => {
    expect(eligible()).toBe(true)
    expect(eligible({ nowMs: now - timeoutMs })).toBe(false)
    expect(eligible({ run: { ...stale, status: 'completed' } })).toBe(false)
    expect(eligible({ run: { ...stale, status: 'failed' } })).toBe(false)
  })
  it('never retires a run this worker still owns even after the timeout', () => {
    expect(eligible({ activeRunIds: new Set([stale.id]) })).toBe(false)
    expect(eligible({ activeJobIds: new Set([stale.jobId]) })).toBe(false)
    expect(eligible({ activeRunIds: new Set(['other']) })).toBe(true)
  })
  it('fails closed on missing, future, or malformed time evidence', () => {
    expect(eligible({ run: { ...stale, startedAt: 'not-a-date' } })).toBe(false)
    expect(eligible({ run: { ...stale, startedAt: '2026-10-29T06:00:00Z' } })).toBe(false)
    expect(eligible({ nowMs: Number.NaN })).toBe(false)
    expect(eligible({ timeoutMs: -1 })).toBe(false)
  })
  it('does not call a record stale at the exact cutoff', () => {
    expect(eligible({
      run: { ...stale, startedAt: '2026-10-29T04:50:00.000Z' },
    })).toBe(false)
  })
})
