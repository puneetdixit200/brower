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
