import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScheduledJobRunRoutes } from '../../../src/api/routes/scheduled-job-runs'
import { closeDb, initializeDb } from '../../../src/lib/db'
import {
  dbScheduledJobRunStore,
  MAX_RUNS_PER_JOB,
} from '../../../src/lib/schedules/run-store'
import { dbScheduledJobStore } from '../../../src/lib/schedules/schedule-store'

const JOB_ID = 'job-1'
const RUN_ID = 'run-1'

function baseJob() {
  return {
    id: JOB_ID,
    name: 'Morning digest',
    query: 'summarise my inbox',
    scheduleType: 'daily' as const,
  }
}

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    jobId: JOB_ID,
    status: 'completed' as const,
    startedAt: 1000,
    ...overrides,
  }
}

describe('dbScheduledJobRunStore', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    closeDb()
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  async function useTempDbWithJob(jobOverrides: Record<string, unknown> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-runs-test-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'db', 'browseros.sqlite') })
    await dbScheduledJobStore.upsert({ ...baseJob(), ...jobOverrides })
  }

  test('round-trips a run including its tool calls', async () => {
    await useTempDbWithJob()
    const toolCalls = [
      {
        id: 'call-1',
        name: 'browser_navigate',
        input: { url: 'https://example.com' },
        output: { ok: true },
        timestamp: '2026-01-02T03:04:05.000Z',
      },
    ]

    await dbScheduledJobRunStore.upsert(baseRun({ toolCalls }))

    expect((await dbScheduledJobRunStore.get(RUN_ID))?.toolCalls).toEqual(
      toolCalls,
    )
  })

  // A run is written when it starts and again when it finishes, so the update
  // path is the ordinary one rather than an edge case.
  test('upsert moves a run from running to completed', async () => {
    await useTempDbWithJob()
    await dbScheduledJobRunStore.upsert(baseRun({ status: 'running' }))

    await dbScheduledJobRunStore.upsert(
      baseRun({ status: 'completed', completedAt: 2000, result: 'done' }),
    )

    const saved = await dbScheduledJobRunStore.get(RUN_ID)
    expect(saved).toMatchObject({
      status: 'completed',
      completedAt: 2000,
      result: 'done',
    })
    expect(await dbScheduledJobRunStore.list()).toHaveLength(1)
  })

  test('atomically allows only one running run per job', async () => {
    await useTempDbWithJob()
    const [first, second] = await Promise.all([
      dbScheduledJobRunStore.start(baseRun({ id: 'first', status: 'running' })),
      dbScheduledJobRunStore.start(
        baseRun({ id: 'second', status: 'running' }),
      ),
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect(
      (await dbScheduledJobRunStore.list()).filter(
        (run) => run.status === 'running',
      ),
    ).toHaveLength(1)
  })

  test('treats a retry with the same run id as an idempotent claim', async () => {
    await useTempDbWithJob()
    const first = await dbScheduledJobRunStore.start(
      baseRun({ id: 'retryable-run', status: 'running' }),
    )
    const retry = await dbScheduledJobRunStore.start(
      baseRun({ id: 'retryable-run', status: 'running' }),
    )

    expect(retry).toEqual(first)
    expect(
      await dbScheduledJobRunStore.start(
        baseRun({ id: 'retryable-run', status: 'running', startedAt: 2000 }),
      ),
    ).toBeNull()
    expect(await dbScheduledJobRunStore.list()).toHaveLength(1)
  })

  test('heartbeat claims must use the saved job conversation identity', async () => {
    const conversationId = '11111111-1111-4111-8111-111111111111'
    await useTempDbWithJob({ mode: 'heartbeat', conversationId })

    expect(
      await dbScheduledJobRunStore.start(
        baseRun({
          id: 'wrong-conversation',
          status: 'running',
          conversationId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).toBeNull()
    expect(
      await dbScheduledJobRunStore.start(
        baseRun({
          id: 'right-conversation',
          status: 'running',
          conversationId,
        }),
      ),
    ).toMatchObject({ conversationId, status: 'running' })
  })

  test('SQLite route cannot delete a running claim and admit a competitor', async () => {
    await useTempDbWithJob()
    const routes = createScheduledJobRunRoutes()
    const put = (id: string) =>
      routes.request(`/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: JOB_ID,
          status: 'running',
          startedAt: 1000,
        }),
      })

    expect((await put('active-run')).status).toBe(200)
    expect(
      (await routes.request('/active-run', { method: 'DELETE' })).status,
    ).toBe(409)
    expect(await dbScheduledJobRunStore.remove('active-run')).toBe('running')
    expect((await put('competing-run')).status).toBe(409)
    expect(await dbScheduledJobRunStore.get('active-run')).toMatchObject({
      status: 'running',
    })
  })

  test('SQLite route rejects a run for a missing scheduled job', async () => {
    await useTempDbWithJob()
    const routes = createScheduledJobRunRoutes()
    const response = await routes.request('/orphan-run', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'missing-job',
        status: 'running',
        startedAt: 1000,
      }),
    })

    expect(response.status).toBe(409)
    expect(await dbScheduledJobRunStore.get('orphan-run')).toBeNull()
  })

  test('finish preserves run identity and is idempotent after completion', async () => {
    await useTempDbWithJob()
    const running = await dbScheduledJobRunStore.start(
      baseRun({
        status: 'running',
        conversationId: '11111111-1111-4111-8111-111111111111',
      }),
    )
    expect(running).not.toBeNull()

    expect(
      await dbScheduledJobRunStore.finish(
        baseRun({
          status: 'completed',
          conversationId: '22222222-2222-4222-8222-222222222222',
          completedAt: 2000,
        }),
      ),
    ).toBeNull()

    const completion = baseRun({
      status: 'completed',
      conversationId: '11111111-1111-4111-8111-111111111111',
      completedAt: 2000,
      result: 'done',
    })
    const saved = await dbScheduledJobRunStore.finish(completion)
    expect(saved).toMatchObject({ status: 'completed', result: 'done' })
    expect(
      await dbScheduledJobRunStore.finish({ ...completion, result: 'changed' }),
    ).toEqual(saved)
    expect(await dbScheduledJobRunStore.get(RUN_ID)).toMatchObject({
      conversationId: '11111111-1111-4111-8111-111111111111',
      result: 'done',
    })
  })

  // Cascade, unlike the job to provider reference which is set null. A run
  // whose job is gone means nothing, and deleting a job already removed its
  // runs before this table existed.
  test('deleting a job removes its runs', async () => {
    await useTempDbWithJob()
    await dbScheduledJobRunStore.upsert(baseRun())

    await dbScheduledJobStore.remove(JOB_ID)

    expect(await dbScheduledJobRunStore.list()).toEqual([])
  })

  test('lists newest first', async () => {
    await useTempDbWithJob()
    await dbScheduledJobRunStore.upsert(baseRun({ id: 'old', startedAt: 1000 }))
    await dbScheduledJobRunStore.upsert(baseRun({ id: 'new', startedAt: 3000 }))

    expect((await dbScheduledJobRunStore.list()).map((r) => r.id)).toEqual([
      'new',
      'old',
    ])
  })

  // The extension applied this cap while it owned the history, so keeping it
  // is preserving behaviour rather than adding a policy.
  test('prune keeps the newest runs of a job and drops the rest', async () => {
    await useTempDbWithJob()
    for (let i = 0; i < MAX_RUNS_PER_JOB + 5; i += 1) {
      await dbScheduledJobRunStore.upsert(
        baseRun({ id: `run-${i}`, startedAt: 1000 + i }),
      )
    }

    const dropped = await dbScheduledJobRunStore.prune(JOB_ID)

    expect(dropped).toBe(5)
    const remaining = await dbScheduledJobRunStore.list()
    expect(remaining).toHaveLength(MAX_RUNS_PER_JOB)
    expect(remaining[0].startedAt).toBe(1000 + MAX_RUNS_PER_JOB + 4)
  })

  test('prune preserves an old running claim beyond terminal retention', async () => {
    await useTempDbWithJob()
    for (let i = 0; i < MAX_RUNS_PER_JOB; i += 1) {
      await dbScheduledJobRunStore.upsert(
        baseRun({ id: `terminal-${i}`, startedAt: 10_000 + i }),
      )
    }
    const active = await dbScheduledJobRunStore.start(
      baseRun({ id: 'old-running', status: 'running', startedAt: 1 }),
    )

    expect(active).not.toBeNull()
    expect(await dbScheduledJobRunStore.prune(JOB_ID)).toBe(0)
    expect(await dbScheduledJobRunStore.get('old-running')).toMatchObject({
      status: 'running',
      startedAt: 1,
    })
    expect(
      await dbScheduledJobRunStore.start(
        baseRun({ id: 'second-running', status: 'running', startedAt: 20_000 }),
      ),
    ).toBeNull()
  })

  test('prune leaves a job under the cap alone', async () => {
    await useTempDbWithJob()
    await dbScheduledJobRunStore.upsert(baseRun())

    expect(await dbScheduledJobRunStore.prune(JOB_ID)).toBe(0)
    expect(await dbScheduledJobRunStore.list()).toHaveLength(1)
  })

  test('prune only touches the job it was given', async () => {
    await useTempDbWithJob()
    await dbScheduledJobStore.upsert({ ...baseJob(), id: 'job-2' })
    await dbScheduledJobRunStore.upsert(
      baseRun({ id: 'other', jobId: 'job-2' }),
    )
    for (let i = 0; i < MAX_RUNS_PER_JOB + 2; i += 1) {
      await dbScheduledJobRunStore.upsert(
        baseRun({ id: `run-${i}`, startedAt: 1000 + i }),
      )
    }

    await dbScheduledJobRunStore.prune(JOB_ID)

    const ids = (await dbScheduledJobRunStore.list()).map((r) => r.id)
    expect(ids).toContain('other')
    expect(ids).toHaveLength(MAX_RUNS_PER_JOB + 1)
  })
})
