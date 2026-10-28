import { onScheduleMessage } from '@/lib/messaging/schedules/scheduleMessages'
import { createAlarmFromJob } from '@/lib/schedules/createAlarmFromJob'
import { getChatServerResponse } from '@/lib/schedules/getChatServerResponse'
import { mayContinueHeartbeat } from '@/lib/schedules/heartbeat-continuation'
import { isAlarmWithinGracePeriod } from '@/lib/schedules/scheduled-run-policy'
import type { ScheduledJobRun } from '@/lib/schedules/scheduleTypes'
import {
  listScheduledJobRunsOrNull,
  listScheduledJobsOrNull,
  putScheduledJob,
  putScheduledJobRun,
} from '@/modules/schedules/schedules.api'
import { applyLastRunAt } from '@/modules/schedules/schedules.helpers'

const STALE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const activeJobIds = new Set<string>()

const runAbortControllers = new Map<string, AbortController>()

export const scheduledJobRuns = async () => {
  // Every read below distinguishes an unreachable server from an empty list.
  // Treating the two alike would look like "nothing is scheduled": alarms would
  // not be rebuilt on startup and schedules would quietly stop firing, with no
  // failed run to show for it. Skipping the pass instead leaves the next
  // startup to retry.
  const cleanupStaleJobRuns = async () => {
    const current = await listScheduledJobRunsOrNull()
    if (current === null) return
    const now = Date.now()

    const stale = current.filter(
      (run) =>
        run.status === 'running' &&
        now - new Date(run.startedAt).getTime() > STALE_TIMEOUT_MS,
    )

    for (const run of stale) {
      await putScheduledJobRun({
        ...run,
        status: 'failed',
        completedAt: new Date().toISOString(),
        result: 'Job timed out!',
      })
    }
  }

  const syncAlarmState = async () => {
    const loaded = await listScheduledJobsOrNull()
    if (loaded === null) return
    // Rebuild schedules from now on startup/install. An alarm that expired
    // while the browser was closed must not become an unattended catch-up run.
    const alarms = await chrome.alarms.getAll()
    for (const alarm of alarms) {
      if (alarm.name.startsWith('scheduled-job-')) {
        await chrome.alarms.clear(alarm.name)
      }
    }
    const jobs = loaded.filter((each) => each.enabled)

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      const alarmName = `scheduled-job-${job.id}`
      const existingAlarm = await chrome.alarms.get(alarmName)

      if (!existingAlarm) {
        await createAlarmFromJob(job)
      }
    }
  }

  const createJobRun = async (
    jobId: string,
    status: ScheduledJobRun['status'],
    conversationId?: string,
  ): Promise<ScheduledJobRun> => {
    // Trimming to the per-job cap happens on the server now, so creating a run
    // no longer has to rewrite the job's whole history to stay bounded.
    const jobRun: ScheduledJobRun = {
      id: crypto.randomUUID(),
      jobId,
      conversationId,
      startedAt: new Date().toISOString(),
      status,
    }

    await putScheduledJobRun(jobRun)
    return jobRun
  }

  // Takes the run rather than its id: the caller already holds it, and merging
  // locally avoids re-reading a list to update one row.
  const updateJobRun = async (
    run: ScheduledJobRun,
    updates: Partial<Omit<ScheduledJobRun, 'id' | 'jobId' | 'startedAt'>>,
  ) => {
    await putScheduledJobRun({ ...run, ...updates })
  }

  // Takes an id, not the job: a snapshot captured before the run would be
  // minutes stale by the time this writes, and putting it back would revert any
  // edit made while the run was going.
  const updateJobLastRunAt = async (jobId: string) => {
    const jobs = await listScheduledJobsOrNull()
    if (jobs === null) return

    const updated = applyLastRunAt(jobs, jobId, new Date().toISOString())
    if (updated) await putScheduledJob(updated)
  }

  const executeScheduledJob = async (jobId: string): Promise<void> => {
    if (activeJobIds.has(jobId)) {
      throw new Error(`Job is already running: ${jobId}`)
    }
    activeJobIds.add(jobId)
    try {
      const jobs = await listScheduledJobsOrNull()
      if (jobs === null) {
        throw new Error('Cannot reach the BrowserOS server to load the job')
      }

      const job = jobs.find((each) => each.id === jobId)
      if (!job) {
        throw new Error(`Job not found: ${jobId}`)
      }

      if (job.mode === 'heartbeat') {
        const previousRuns = await listScheduledJobRunsOrNull()
        if (previousRuns === null) {
          throw new Error(
            'Cannot verify the previous heartbeat before continuing',
          )
        }
        const previous = previousRuns
          .filter((run) => run.jobId === jobId)
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0]
        if (!mayContinueHeartbeat(previous?.status)) {
          throw new Error(
            'Heartbeat paused because its previous run did not complete; review the run before resuming',
          )
        }
      }

      let conversationId = job.conversationId
      if (job.mode === 'heartbeat' && !conversationId) {
        conversationId = crypto.randomUUID()
        const updatedJob = {
          ...job,
          conversationId,
          updatedAt: new Date().toISOString(),
        }
        await putScheduledJob(updatedJob)
      }

      const jobRun = await createJobRun(jobId, 'running', conversationId)
      const abortController = new AbortController()
      runAbortControllers.set(jobRun.id, abortController)

      try {
        const response = await getChatServerResponse({
          message: job.query,
          conversationId,
          persistScheduledTask: job.mode === 'heartbeat',
          signal: abortController.signal,
          providerId: job.providerId,
        })

        await updateJobRun(jobRun, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          result: response.text,
          finalResult: response.finalResult,
          executionLog: response.executionLog,
          toolCalls: response.toolCalls,
        })
      } catch (e) {
        const isCancelled = abortController.signal.aborted
        const errorMessage = isCancelled
          ? 'Cancelled by user'
          : e instanceof Error
            ? e.message
            : String(e)
        await updateJobRun(jobRun, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          result: errorMessage,
          error: errorMessage,
        })
      } finally {
        runAbortControllers.delete(jobRun.id)
        await updateJobLastRunAt(jobId)
      }
    } finally {
      activeJobIds.delete(jobId)
    }
  }

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('scheduled-job-')) return
    // A Chrome alarm may be delivered late after system sleep. Skip it after
    // the supported one-minute grace window; the recurring alarm remains set.
    if (!isAlarmWithinGracePeriod(alarm.scheduledTime, Date.now())) return
    const jobId = alarm.name.replace('scheduled-job-', '')
    try {
      await executeScheduledJob(jobId)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== `Job is already running: ${jobId}`
      ) {
        throw error
      }
    }
  })

  onScheduleMessage('runScheduledJob', async ({ data }) => {
    try {
      await executeScheduledJob(data.jobId)
      return { success: true }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

  onScheduleMessage('cancelScheduledJobRun', async ({ data }) => {
    const controller = runAbortControllers.get(data.runId)
    if (!controller) {
      return { success: false, error: 'Run not found or already completed' }
    }
    controller.abort()
    return { success: true }
  })

  chrome.runtime.onStartup.addListener(async () => {
    await cleanupStaleJobRuns()
    await syncAlarmState()
  })

  chrome.runtime.onInstalled.addListener(async () => {
    await cleanupStaleJobRuns()
    await syncAlarmState()
  })

  // Chrome idle->active can follow a suspended laptop. It is not a guaranteed
  // OS resume event, but safely reconciles server history and future alarms.
  // No missed alarms are replayed or auto-caught-up after resume.
  chrome.idle.setDetectionInterval(60)
  chrome.idle.onStateChanged.addListener((state) => {
    if (state !== 'active') return
    void (async () => {
      await cleanupStaleJobRuns()
      await syncAlarmState()
    })().catch(() => {
      // Server may be restarting after sleep; a later startup/idle
      // transition can retry. Do not claim a task succeeded.
    })
  })
}
