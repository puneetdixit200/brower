import { describe, expect, test } from 'bun:test'
import {
  isAlarmWithinGracePeriod,
  SCHEDULED_ALARM_GRACE_MS,
} from './scheduled-run-policy'

describe('scheduled alarm delivery policy', () => {
  test('accepts an alarm delivered on time or within one minute', () => {
    expect(isAlarmWithinGracePeriod(10_000, 10_000)).toBe(true)
    expect(
      isAlarmWithinGracePeriod(10_000, 10_000 + SCHEDULED_ALARM_GRACE_MS),
    ).toBe(true)
  })

  test('skips alarms delivered after sleep or before their scheduled time', () => {
    expect(
      isAlarmWithinGracePeriod(10_000, 10_001 + SCHEDULED_ALARM_GRACE_MS),
    ).toBe(false)
    expect(isAlarmWithinGracePeriod(10_001, 10_000)).toBe(false)
  })

  test('rejects invalid alarm timestamps', () => {
    expect(isAlarmWithinGracePeriod(Number.NaN, 10_000)).toBe(false)
    expect(isAlarmWithinGracePeriod(10_000, Number.POSITIVE_INFINITY)).toBe(
      false,
    )
  })
})
