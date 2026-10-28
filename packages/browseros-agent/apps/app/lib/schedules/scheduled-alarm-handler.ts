import { isAlarmWithinGracePeriod } from './scheduled-run-policy'
import type { ScheduledJob } from './scheduleTypes'

export const SCHEDULED_JOB_ALARM_PREFIX = 'scheduled-job-'
export const SCHEDULE_RECONCILIATION_ALARM = 'scheduled-jobs-reconcile'

export interface ScheduledAlarmDependencies {
  now(): number
  getJob(jobId: string): Promise<ScheduledJob | undefined | null>
  rearmDaily(job: ScheduledJob): Promise<void>
  scheduleReconciliation(): Promise<void>
  run(jobId: string): Promise<void>
}

export async function handleScheduledAlarm(
  alarm: Pick<chrome.alarms.Alarm, 'name' | 'scheduledTime'>,
  dependencies: ScheduledAlarmDependencies,
): Promise<void> {
  if (!alarm.name.startsWith(SCHEDULED_JOB_ALARM_PREFIX)) return

  // Capture delivery time before any server or alarm API work so latency does
  // not change whether this delivery falls inside the grace window.
  const deliveredAt = dependencies.now()
  const jobId = alarm.name.slice(SCHEDULED_JOB_ALARM_PREFIX.length)

  let job: ScheduledJob | undefined | null
  try {
    job = await dependencies.getJob(jobId)
  } catch {
    await dependencies.scheduleReconciliation()
    return
  }

  // null means the job store is unavailable; undefined means the store was
  // read successfully and the job no longer exists.
  if (job === null) {
    await dependencies.scheduleReconciliation()
    return
  }
  if (!job) return
  if (!job.enabled) return

  if (job.scheduleType === 'daily') {
    try {
      await dependencies.rearmDaily(job)
    } catch {
      await dependencies.scheduleReconciliation()
    }
  }

  if (!isAlarmWithinGracePeriod(alarm.scheduledTime, deliveredAt)) return
  await dependencies.run(jobId)
}
