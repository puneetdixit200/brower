import type { ScheduledJobRun } from './scheduleTypes'

/**
 * A stale durable record is only a candidate for interruption when this worker
 * does not currently own its run. Long browser/model operations can exceed the
 * timeout without being abandoned; their active abort controller takes priority.
 *
 * This is a local-worker check, NOT cross-process liveness proof. The server's
 * unique running-job slot still arbitrates concurrent writers.
 */
export function shouldFailStaleScheduledRun(input: {
  run: Pick<ScheduledJobRun, 'id' | 'jobId' | 'startedAt' | 'status'>
  nowMs: number
  timeoutMs: number
  activeRunIds: ReadonlySet<string>
  activeJobIds: ReadonlySet<string>
}): boolean {
  const { run, nowMs, timeoutMs, activeRunIds, activeJobIds } = input
  if (run.status !== 'running') return false
  if (activeRunIds.has(run.id) || activeJobIds.has(run.jobId)) return false
  const startedMs = Date.parse(run.startedAt)
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(startedMs) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return false
  }
  return nowMs - startedMs > timeoutMs
}

/**
 * Prefer stale records that do not need a conversation liveness request. This
 * keeps live or unreachable heartbeat conversations from occupying the whole
 * bounded cleanup batch and starving ordinary orphaned runs.
 */
export function selectStaleScheduledRunBatch<
  T extends { id: string; conversationId?: string },
>(
  staleRuns: readonly T[],
  limit: number,
  cursor: StaleRunCleanupCursor = {},
): T[] {
  const boundedLimit = Math.max(0, Math.floor(limit))
  if (boundedLimit === 0) return []

  const orphans = staleRuns
    .filter((run) => !run.conversationId)
    .sort((a, b) => a.id.localeCompare(b.id))
  const conversations = staleRuns
    .filter((run) => Boolean(run.conversationId))
    .sort((a, b) => a.id.localeCompare(b.id))

  // Orphans keep priority, but each class has its own rotating window. Reserve
  // one slot for a heartbeat when possible. A one-item mixed batch alternates
  // classes using nextClass; no single batch can include both classes.
  if (boundedLimit === 1 && orphans.length > 0 && conversations.length > 0) {
    const preferred = cursor.nextClass === 'heartbeat' ? 'heartbeat' : 'orphan'
    const selectedClass = preferred === 'orphan' ? orphans : conversations
    const afterRunId =
      preferred === 'orphan'
        ? cursor.afterOrphanRunId
        : cursor.afterHeartbeatRunId
    return selectRunWindow(selectedClass, 1, afterRunId)
  }

  const orphanLimit =
    conversations.length > 0 && boundedLimit > 1
      ? boundedLimit - 1
      : boundedLimit
  const batch = selectRunWindow(orphans, orphanLimit, cursor.afterOrphanRunId)
  const remaining = boundedLimit - batch.length
  if (remaining === 0 || conversations.length === 0) return batch

  batch.push(
    ...selectRunWindow(conversations, remaining, cursor.afterHeartbeatRunId),
  )
  return batch
}

export interface StaleRunCleanupCursor {
  afterOrphanRunId?: string
  afterHeartbeatRunId?: string
  nextClass?: 'orphan' | 'heartbeat'
}

export function advanceStaleRunCleanupCursor(
  batch: readonly { id: string; conversationId?: string }[],
  cursor: StaleRunCleanupCursor,
  hasOrphans: boolean,
  hasHeartbeats: boolean,
): StaleRunCleanupCursor {
  const lastOrphan = batch.filter((run) => !run.conversationId).at(-1)?.id
  const lastHeartbeat = batch
    .filter((run) => Boolean(run.conversationId))
    .at(-1)?.id
  const bothClassesPresent = hasOrphans && hasHeartbeats

  return {
    afterOrphanRunId: lastOrphan ?? cursor.afterOrphanRunId,
    afterHeartbeatRunId: lastHeartbeat ?? cursor.afterHeartbeatRunId,
    nextClass:
      bothClassesPresent && batch.length === 1
        ? lastOrphan
          ? 'heartbeat'
          : 'orphan'
        : cursor.nextClass,
  }
}

function selectRunWindow<T extends { id: string }>(
  runs: readonly T[],
  limit: number,
  afterRunId?: string,
): T[] {
  if (limit <= 0 || runs.length === 0) return []
  const nextIndex = runs.findIndex(
    (run) => afterRunId !== undefined && run.id.localeCompare(afterRunId) > 0,
  )
  const start = nextIndex === -1 ? 0 : nextIndex
  return Array.from(
    { length: Math.min(limit, runs.length) },
    (_, index) => runs[(start + index) % runs.length],
  ).filter((run): run is T => run !== undefined)
}
