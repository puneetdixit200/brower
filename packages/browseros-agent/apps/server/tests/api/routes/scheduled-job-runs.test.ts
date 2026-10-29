import { describe, expect, it } from 'bun:test'
import { createScheduledJobRunRoutes } from '../../../src/api/routes/scheduled-job-runs'
import type { ScheduledJobRunRow } from '../../../src/lib/db/schema'
import type {
  ScheduledJobRunStore,
  ScheduledJobRunUpsert,
} from '../../../src/lib/schedules/run-store'

const RUN_ID = 'run-1'

function row(overrides: Partial<ScheduledJobRunRow> = {}): ScheduledJobRunRow {
  return {
    id: RUN_ID,
    jobId: 'job-1',
    status: 'completed',
    startedAt: 1000,
    completedAt: 2000,
    result: 'done',
    finalResult: null,
    executionLog: null,
    toolCalls: null,
    error: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function memoryStore(initial: ScheduledJobRunRow[] = []) {
  const rows = new Map(initial.map((r) => [r.id, r]))
  const store: ScheduledJobRunStore = {
    list: async () => [...rows.values()],
    get: async (id) => rows.get(id) ?? null,
    upsert: async (input: ScheduledJobRunUpsert) => {
      const existing = rows.get(input.id)
      const saved = {
        ...row(),
        ...input,
        createdAt: existing?.createdAt ?? input.createdAt ?? 100,
        updatedAt: 200,
      } as ScheduledJobRunRow
      rows.set(saved.id, saved)
      return saved
    },
    start: async (input: ScheduledJobRunUpsert) => {
      const sameRun = rows.get(input.id)
      if (
        sameRun?.jobId === input.jobId &&
        sameRun.status === 'running' &&
        sameRun.startedAt === input.startedAt &&
        (sameRun.conversationId ?? null) === (input.conversationId ?? null)
      ) {
        return sameRun
      }
      if (
        [...rows.values()].some(
          (run) => run.jobId === input.jobId && run.status === 'running',
        )
      ) {
        return null
      }
      const saved = {
        ...row(),
        ...input,
        status: 'running',
        createdAt: input.createdAt ?? 100,
        updatedAt: 200,
      } as ScheduledJobRunRow
      rows.set(saved.id, saved)
      return saved
    },
    startWithOutcome: async (input: ScheduledJobRunUpsert) => {
      const run = await store.start(input)
      return run ? { kind: 'started', run } : { kind: 'conflict' }
    },
    finish: async (input: ScheduledJobRunUpsert) => {
      const existing = rows.get(input.id)
      if (
        existing?.jobId === input.jobId &&
        existing.startedAt === input.startedAt &&
        (existing.conversationId ?? null) === (input.conversationId ?? null) &&
        existing.status === 'running'
      ) {
        const saved = {
          ...existing,
          ...input,
          updatedAt: 300,
        } as ScheduledJobRunRow
        rows.set(saved.id, saved)
        return saved
      }
      if (
        existing?.jobId === input.jobId &&
        existing.startedAt === input.startedAt &&
        (existing.conversationId ?? null) === (input.conversationId ?? null) &&
        existing.status === input.status
      ) {
        return existing
      }
      return null
    },
    remove: async (id) => {
      const existing = rows.get(id)
      if (!existing) return 'missing'
      if (existing.status === 'running') return 'running'
      rows.delete(id)
      return 'removed'
    },
    prune: async (jobId, keep = 15) => {
      const ofJob = [...rows.values()]
        .filter((r) => r.jobId === jobId)
        .sort((a, b) => b.startedAt - a.startedAt)
      const stale = ofJob.slice(keep)
      for (const run of stale) rows.delete(run.id)
      return stale.length
    },
  }
  return { store, rows }
}

const body = {
  jobId: 'job-1',
  status: 'running' as const,
  startedAt: 1000,
}

function put(
  routes: ReturnType<typeof createScheduledJobRunRoutes>,
  payload: unknown,
  runId = RUN_ID,
) {
  return routes.request(`/${runId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('scheduled job run routes', () => {
  it('lists runs', async () => {
    const routes = createScheduledJobRunRoutes(memoryStore([row()]))
    const response = await routes.request('/')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ runs: [{ id: RUN_ID }] })
  })

  it('writes a run', async () => {
    const { store, rows } = memoryStore()
    const response = await put(createScheduledJobRunRoutes({ store }), body)

    expect(response.status).toBe(200)
    expect(rows.get(RUN_ID)).toMatchObject({ status: 'running' })
  })

  it('rejects a second running run for the same job', async () => {
    const { store, rows } = memoryStore()
    const routes = createScheduledJobRunRoutes({ store })
    expect((await put(routes, body, 'first')).status).toBe(200)
    const second = await put(routes, body, 'second')

    expect(second.status).toBe(409)
    expect(rows.size).toBe(1)
    expect(rows.has('first')).toBe(true)
  })

  it('returns the existing run when the same start request is retried', async () => {
    const { store, rows } = memoryStore()
    const routes = createScheduledJobRunRoutes({ store })

    expect((await put(routes, body, 'retryable-run')).status).toBe(200)
    const retry = await put(routes, body, 'retryable-run')

    expect(retry.status).toBe(200)
    expect(rows.size).toBe(1)
    expect(rows.get('retryable-run')).toMatchObject({
      status: 'running',
      startedAt: 1000,
    })
  })

  it('rejects retries and terminal updates with a changed run identity', async () => {
    const { store, rows } = memoryStore()
    const routes = createScheduledJobRunRoutes({ store })
    await put(routes, body, 'identity-run')

    const changedStart = await put(
      routes,
      { ...body, startedAt: 2000 },
      'identity-run',
    )
    expect(changedStart.status).toBe(409)

    const response = await put(
      routes,
      {
        ...body,
        status: 'completed',
        conversationId: '11111111-1111-4111-8111-111111111111',
        completedAt: 2000,
      },
      'identity-run',
    )

    expect(response.status).toBe(409)
    expect(rows.get('identity-run')).toMatchObject({ status: 'running' })
  })

  it('allows a terminal retry without rewriting the completed run', async () => {
    const { store, rows } = memoryStore()
    const routes = createScheduledJobRunRoutes({ store })
    await put(routes, body, 'terminal-retry')
    const completed = {
      ...body,
      status: 'completed' as const,
      completedAt: 2000,
      result: 'done',
    }

    expect((await put(routes, completed, 'terminal-retry')).status).toBe(200)
    const retry = await put(
      routes,
      { ...completed, result: 'rewritten' },
      'terminal-retry',
    )

    expect(retry.status).toBe(200)
    expect(rows.get('terminal-retry')?.result).toBe('done')
  })

  it('keeps the tool call log across a write', async () => {
    const { store, rows } = memoryStore()
    const toolCalls = [
      {
        id: 'call-1',
        name: 'browser_navigate',
        input: { url: 'https://example.com' },
        timestamp: '2026-01-02T03:04:05.000Z',
      },
    ]

    await put(createScheduledJobRunRoutes({ store }), { ...body, toolCalls })

    expect(rows.get(RUN_ID)?.toolCalls).toEqual(toolCalls)
  })

  // The cap moved here from the extension, so a write has to apply it or the
  // history grows without bound now that nothing else trims it.
  it('trims a job past the run cap on write', async () => {
    const existing = Array.from({ length: 15 }, (_, i) =>
      row({ id: `run-${i}`, startedAt: 1000 + i }),
    )
    const { store, rows } = memoryStore(existing)

    await put(
      createScheduledJobRunRoutes({ store }),
      { ...body, startedAt: 9999 },
      'run-new',
    )

    expect(rows.size).toBe(15)
    expect(rows.has('run-0')).toBe(false)
    expect(rows.has('run-new')).toBe(true)
  })

  it('rejects a status the schema does not know', async () => {
    const routes = createScheduledJobRunRoutes(memoryStore())
    const response = await put(routes, { ...body, status: 'cancelled' })

    expect(response.status).toBe(400)
  })

  it('returns 404 for an unknown run', async () => {
    const routes = createScheduledJobRunRoutes(memoryStore())
    expect((await routes.request(`/${RUN_ID}`)).status).toBe(404)
  })

  it('deletes a run', async () => {
    const { store, rows } = memoryStore([row()])
    const routes = createScheduledJobRunRoutes({ store })

    expect(
      (await routes.request(`/${RUN_ID}`, { method: 'DELETE' })).status,
    ).toBe(200)
    expect(rows.size).toBe(0)
  })

  it('rejects deleting a running run', async () => {
    const routes = createScheduledJobRunRoutes(
      memoryStore([row({ status: 'running', completedAt: null })]),
    )

    const response = await routes.request(`/${RUN_ID}`, { method: 'DELETE' })

    expect(response.status).toBe(409)
  })
})
