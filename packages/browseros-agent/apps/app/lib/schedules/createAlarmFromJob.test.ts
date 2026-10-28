import { describe, expect, test } from 'bun:test'
import { getNextScheduledTime } from './createAlarmFromJob'

const testNewYork =
  Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York'
    ? test
    : test.skip

describe('daily schedule wall-clock policy', () => {
  test('uses the next local occurrence and rolls to tomorrow after today passed', () => {
    const beforeSchedule = new Date(2026, 4, 4, 8, 0)
    const atSchedule = new Date(2026, 4, 4, 9, 15)

    expect(getNextScheduledTime('09:15', beforeSchedule)).toBe(
      atSchedule.getTime(),
    )
    expect(getNextScheduledTime('09:15', atSchedule)).toBe(
      new Date(2026, 4, 5, 9, 15).getTime(),
    )
  })

  testNewYork(
    'normalizes a nonexistent spring-forward wall time deterministically',
    () => {
      // On this date 02:30 does not exist. JavaScript local-time normalization
      // selects 03:30 EDT, and the next alarm is still one local day later.
      expect(
        new Date(
          getNextScheduledTime('02:30', new Date('2026-03-08T06:30:00.000Z')),
        ).toISOString(),
      ).toBe('2026-03-08T07:30:00.000Z')
      expect(
        new Date(
          getNextScheduledTime('02:30', new Date('2026-03-08T08:00:00.000Z')),
        ).toISOString(),
      ).toBe('2026-03-09T06:30:00.000Z')
    },
  )

  testNewYork(
    'chooses the earlier occurrence of an ambiguous fall-back wall time',
    () => {
      // 01:30 occurs twice on fall-back day. Local Date construction chooses
      // the earlier (EDT) instant; subsequent daily runs use the new offset.
      expect(
        new Date(
          getNextScheduledTime('01:30', new Date('2026-11-01T04:30:00.000Z')),
        ).toISOString(),
      ).toBe('2026-11-01T05:30:00.000Z')
      expect(
        new Date(
          getNextScheduledTime('01:30', new Date('2026-11-01T06:00:00.000Z')),
        ).toISOString(),
      ).toBe('2026-11-02T06:30:00.000Z')
    },
  )
})
