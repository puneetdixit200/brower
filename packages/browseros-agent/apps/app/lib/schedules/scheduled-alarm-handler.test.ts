import { describe, expect, test } from 'bun:test'
import { handleScheduledAlarm } from './scheduled-alarm-handler'
import type { ScheduledJob } from './scheduleTypes'

const dailyJob: ScheduledJob = {
  id: 'daily-1',
  name: 'Daily',
  query: 'Run',
  mode: 'task',
  scheduleType: 'daily',
  scheduleTime: '09:00',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('scheduled alarm delivery handling', () => {
  test('uses the delivery timestamp even when loading the job takes past grace', async () => {
    let currentTime = 10_000
    const calls: string[] = []
    let occurrenceKey: string | undefined

    await handleScheduledAlarm(
      { name: 'scheduled-job-daily-1', scheduledTime: 10_000 },
      {
        now: () => currentTime,
        getJob: async () => {
          currentTime += 90_000
          return dailyJob
        },
        rearmDaily: async () => {
          calls.push('rearm')
        },
        scheduleReconciliation: async () => {
          calls.push('reconcile')
        },
        run: async (_jobId, key) => {
          occurrenceKey = key
          calls.push('run')
        },
      },
    )

    expect(calls).toEqual(['rearm', 'run'])
    expect(occurrenceKey).toBe(new Date(10_000).toISOString())
  })

  test('schedules reconciliation instead of losing a daily alarm when the store is unavailable', async () => {
    const calls: string[] = []

    await handleScheduledAlarm(
      { name: 'scheduled-job-daily-1', scheduledTime: 10_000 },
      {
        now: () => 10_000,
        getJob: async () => null,
        rearmDaily: async () => {
          calls.push('rearm')
        },
        scheduleReconciliation: async () => {
          calls.push('reconcile')
        },
        run: async () => {
          calls.push('run')
        },
      },
    )

    expect(calls).toEqual(['reconcile'])
  })

  test('schedules reconciliation if daily rearming fails and still honors timely delivery', async () => {
    const calls: string[] = []

    await handleScheduledAlarm(
      { name: 'scheduled-job-daily-1', scheduledTime: 10_000 },
      {
        now: () => 10_000,
        getJob: async () => dailyJob,
        rearmDaily: async () => {
          throw new Error('alarm API unavailable')
        },
        scheduleReconciliation: async () => {
          calls.push('reconcile')
        },
        run: async () => {
          calls.push('run')
        },
      },
    )

    expect(calls).toEqual(['reconcile', 'run'])
  })

  test('ignores stale alarms after a job has been disabled', async () => {
    const calls: string[] = []

    await handleScheduledAlarm(
      { name: 'scheduled-job-daily-1', scheduledTime: 10_000 },
      {
        now: () => 10_000,
        getJob: async () => ({ ...dailyJob, enabled: false }),
        rearmDaily: async () => {
          calls.push('rearm')
        },
        scheduleReconciliation: async () => {
          calls.push('reconcile')
        },
        run: async () => {
          calls.push('run')
        },
      },
    )

    expect(calls).toEqual([])
  })
})
