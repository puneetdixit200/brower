import type { ScheduledJobRunStore } from './run-store'
import { dbScheduledJobRunStore } from './run-store'
import type { ScheduledJobStore } from './schedule-store'
import { dbScheduledJobStore } from './schedule-store'

/**
 * Derive continuation status from server-owned schedule and run records. The
 * caller's task text or continuation checkpoint is never treated as authority.
 */
export async function isHeartbeatContinuation(
  conversationId: string,
  jobs: Pick<ScheduledJobStore, 'list'> = dbScheduledJobStore,
  runs: Pick<ScheduledJobRunStore, 'list'> = dbScheduledJobRunStore,
): Promise<boolean> {
  const job = (await jobs.list()).find(
    (candidate) =>
      candidate.mode === 'heartbeat' &&
      candidate.conversationId === conversationId,
  )
  if (!job) return false

  return (await runs.list()).some(
    (run) =>
      run.jobId === job.id &&
      run.conversationId === conversationId &&
      run.status !== 'running',
  )
}
