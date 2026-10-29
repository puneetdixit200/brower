import { describe, expect, it } from 'bun:test'
import {
  handleStaleRunCleanupAlarm,
  readStaleRunCleanupCursor,
  STALE_RUN_CLEANUP_ALARM,
  STALE_RUN_CLEANUP_PERIOD_MINUTES,
  scheduleStaleRunCleanupAlarm,
  writeStaleRunCleanupCursor,
} from './stale-run-cleanup'

describe('stale-run cleanup alarm and cursor', () => {
  it('uses a dedicated five-minute alarm name', () => {
    expect(STALE_RUN_CLEANUP_ALARM).toBe('scheduled-jobs-stale-cleanup')
    expect(STALE_RUN_CLEANUP_PERIOD_MINUTES).toBe(5)
  })

  it('creates a repeating cleanup alarm without changing schedule alarms', async () => {
    const calls: Array<{ name: string; options: unknown }> = []
    await scheduleStaleRunCleanupAlarm(async (name, options) => {
      calls.push({ name, options })
    })

    expect(calls).toEqual([
      {
        name: STALE_RUN_CLEANUP_ALARM,
        options: { delayInMinutes: 5, periodInMinutes: 5 },
      },
    ])
  })

  it('runs cleanup only for the dedicated alarm', async () => {
    const calls: string[] = []
    const cleanup = async () => {
      calls.push('cleanup')
    }

    expect(
      await handleStaleRunCleanupAlarm('scheduled-jobs-reconcile', cleanup),
    ).toBe(false)
    expect(
      await handleStaleRunCleanupAlarm(STALE_RUN_CLEANUP_ALARM, cleanup),
    ).toBe(true)
    expect(calls).toEqual(['cleanup'])
  })

  it('persists per-class markers so a restarted worker advances both windows', async () => {
    const localStorage: Record<string, unknown> = {}
    const makeStore = () => ({
      get: async (key: string) =>
        key in localStorage ? { [key]: localStorage[key] } : {},
      set: async (value: Record<string, unknown>) => {
        Object.assign(localStorage, value)
      },
    })

    const firstWorkerStore = makeStore()
    expect(await readStaleRunCleanupCursor(firstWorkerStore)).toEqual({})
    const nextCursor = {
      afterOrphanRunId: 'orphan-08',
      afterHeartbeatRunId: 'heartbeat-09',
      nextClass: 'heartbeat' as const,
    }
    await writeStaleRunCleanupCursor(firstWorkerStore, nextCursor)

    const restartedWorkerStore = makeStore()
    expect(await readStaleRunCleanupCursor(restartedWorkerStore)).toEqual(
      nextCursor,
    )
  })

  it('migrates the legacy heartbeat marker into the new cursor shape', async () => {
    const values: Record<string, unknown> = {
      scheduledJobStaleCleanupAfterRunId: 'heartbeat-09',
    }
    const cursor = await readStaleRunCleanupCursor({
      get: async (key) => (key in values ? { [key]: values[key] } : {}),
      set: async () => undefined,
    })

    expect(cursor).toEqual({ afterHeartbeatRunId: 'heartbeat-09' })
  })

  it('ignores an invalid stored marker', async () => {
    const values: Record<string, unknown> = {
      scheduledJobStaleCleanupAfterRunId: Number.MAX_SAFE_INTEGER + 1,
    }
    const cursor = await readStaleRunCleanupCursor({
      get: async (key) => ({ [key]: values[key] }),
      set: async () => undefined,
    })

    expect(cursor).toEqual({})
  })
})
