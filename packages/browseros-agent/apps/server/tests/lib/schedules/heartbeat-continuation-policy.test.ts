import { describe, expect, it } from 'bun:test'
import { isHeartbeatContinuation } from '../../../src/lib/schedules/heartbeat-continuation-policy'
import type { ScheduledJobRunStore } from '../../../src/lib/schedules/run-store'
import type { ScheduledJobStore } from '../../../src/lib/schedules/schedule-store'

const conversationId = '11111111-1111-4111-8111-111111111111'

function stores(mode: 'task' | 'heartbeat', statuses: string[]) {
  const jobs = {
    list: async () => [{ id: 'job-1', mode, conversationId }],
  } as unknown as Pick<ScheduledJobStore, 'list'>
  const runs = {
    list: async () =>
      statuses.map((status) => ({
        jobId: 'job-1',
        conversationId,
        status,
      })),
  } as unknown as Pick<ScheduledJobRunStore, 'list'>
  return { jobs, runs }
}

describe('server heartbeat continuation identity', () => {
  it('marks a scheduled conversation as a continuation only after a prior terminal run', async () => {
    const firstRun = stores('heartbeat', ['running'])
    expect(
      await isHeartbeatContinuation(
        conversationId,
        firstRun.jobs,
        firstRun.runs,
      ),
    ).toBe(false)

    const continued = stores('heartbeat', ['completed', 'running'])
    expect(
      await isHeartbeatContinuation(
        conversationId,
        continued.jobs,
        continued.runs,
      ),
    ).toBe(true)
  })

  it('does not treat task jobs as heartbeat continuations', async () => {
    const task = stores('task', ['completed', 'running'])
    expect(
      await isHeartbeatContinuation(conversationId, task.jobs, task.runs),
    ).toBe(false)
  })
})
