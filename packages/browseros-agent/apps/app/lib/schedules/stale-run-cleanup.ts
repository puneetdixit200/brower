export const STALE_RUN_CLEANUP_ALARM = 'scheduled-jobs-stale-cleanup'
export const STALE_RUN_CLEANUP_PERIOD_MINUTES = 5

const CURSOR_KEY = 'scheduledJobStaleCleanupCursor'
const LEGACY_CURSOR_KEY = 'scheduledJobStaleCleanupAfterRunId'

export interface StaleRunCleanupCursor {
  afterOrphanRunId?: string
  afterHeartbeatRunId?: string
  nextClass?: 'orphan' | 'heartbeat'
}

export interface StaleRunCleanupCursorStore {
  get(key: string): Promise<Record<string, unknown>>
  set(value: Record<string, unknown>): Promise<void>
}

export async function scheduleStaleRunCleanupAlarm(
  create: (
    name: string,
    options: { delayInMinutes: number; periodInMinutes: number },
  ) => Promise<unknown>,
): Promise<void> {
  await create(STALE_RUN_CLEANUP_ALARM, {
    delayInMinutes: STALE_RUN_CLEANUP_PERIOD_MINUTES,
    periodInMinutes: STALE_RUN_CLEANUP_PERIOD_MINUTES,
  })
}

/** Read the per-class cleanup cursor, migrating the former heartbeat string. */
export async function readStaleRunCleanupCursor(
  store: StaleRunCleanupCursorStore,
): Promise<StaleRunCleanupCursor> {
  const saved = await store.get(CURSOR_KEY)
  const cursor = saved[CURSOR_KEY]
  if (isCleanupCursor(cursor)) return cursor

  const legacy = await store.get(LEGACY_CURSOR_KEY)
  const legacyRunId = legacy[LEGACY_CURSOR_KEY]
  return typeof legacyRunId === 'string' && legacyRunId.length > 0
    ? { afterHeartbeatRunId: legacyRunId }
    : {}
}

/** Persist the next per-class window before processing the selected batch. */
export async function writeStaleRunCleanupCursor(
  store: StaleRunCleanupCursorStore,
  cursor: StaleRunCleanupCursor,
): Promise<void> {
  await store.set({ [CURSOR_KEY]: cursor })
}

function isCleanupCursor(value: unknown): value is StaleRunCleanupCursor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const cursor = value as Record<string, unknown>
  return (
    (cursor.afterOrphanRunId === undefined ||
      typeof cursor.afterOrphanRunId === 'string') &&
    (cursor.afterHeartbeatRunId === undefined ||
      typeof cursor.afterHeartbeatRunId === 'string') &&
    (cursor.nextClass === undefined ||
      cursor.nextClass === 'orphan' ||
      cursor.nextClass === 'heartbeat')
  )
}

/** Route only the dedicated cleanup alarm to stale-run reconciliation. */
export async function handleStaleRunCleanupAlarm(
  alarmName: string,
  cleanup: () => Promise<void>,
): Promise<boolean> {
  if (alarmName !== STALE_RUN_CLEANUP_ALARM) return false
  await cleanup()
  return true
}
