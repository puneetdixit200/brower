import { describe, expect, it } from 'bun:test'
import {
  advanceStaleRunCleanupCursor,
  type StaleRunCleanupCursor,
  selectStaleScheduledRunBatch,
  shouldFailStaleScheduledRun,
} from './stale-run-policy'

const now = Date.parse('2026-10-29T05:00:00.000Z')
const timeoutMs = 10 * 60 * 1000
const stale = {
  id: 'run-1',
  jobId: 'job-1',
  startedAt: '2026-10-29T04:40:00.000Z',
  status: 'running' as const,
}
const empty = new Set<string>()
const eligible = (
  overrides: Partial<Parameters<typeof shouldFailStaleScheduledRun>[0]> = {},
) =>
  shouldFailStaleScheduledRun({
    run: stale,
    nowMs: now,
    timeoutMs,
    activeRunIds: empty,
    activeJobIds: empty,
    ...overrides,
  })

describe('stale scheduled job cleanup', () => {
  it('fails only an orphaned running record older than the configured window', () => {
    expect(eligible()).toBe(true)
    expect(eligible({ nowMs: now - timeoutMs })).toBe(false)
    expect(eligible({ run: { ...stale, status: 'completed' } })).toBe(false)
    expect(eligible({ run: { ...stale, status: 'failed' } })).toBe(false)
  })
  it('never retires a run this worker still owns even after the timeout', () => {
    expect(eligible({ activeRunIds: new Set([stale.id]) })).toBe(false)
    expect(eligible({ activeJobIds: new Set([stale.jobId]) })).toBe(false)
    expect(eligible({ activeRunIds: new Set(['other']) })).toBe(true)
  })
  it('fails closed on missing, future, or malformed time evidence', () => {
    expect(eligible({ run: { ...stale, startedAt: 'not-a-date' } })).toBe(false)
    expect(
      eligible({ run: { ...stale, startedAt: '2026-10-29T06:00:00Z' } }),
    ).toBe(false)
    expect(eligible({ nowMs: Number.NaN })).toBe(false)
    expect(eligible({ timeoutMs: -1 })).toBe(false)
  })
  it('does not call a record stale at the exact cutoff', () => {
    expect(
      eligible({
        run: { ...stale, startedAt: '2026-10-29T04:50:00.000Z' },
      }),
    ).toBe(false)
  })

  it('keeps the cleanup batch bounded while prioritizing orphaned runs', () => {
    const activeHeartbeats = Array.from({ length: 12 }, (_, index) => ({
      id: `heartbeat-${index}`,
      conversationId: `conversation-${index}`,
    }))
    const orphan = { id: 'orphan' }

    const batch = selectStaleScheduledRunBatch(
      [...activeHeartbeats, orphan],
      10,
    )

    expect(batch).toHaveLength(10)
    expect(batch.map((run) => run.id)).toContain(orphan.id)
  })

  it('rotates bounded heartbeat checks so later stale runs are not starved', () => {
    const heartbeats = Array.from({ length: 23 }, (_, index) => ({
      id: `heartbeat-${String(index).padStart(2, '0')}`,
      conversationId: `conversation-${index}`,
    }))

    const first = selectStaleScheduledRunBatch(heartbeats, 10)
    const firstCursor = advanceStaleRunCleanupCursor(first, {}, false, true)
    const second = selectStaleScheduledRunBatch(heartbeats, 10, firstCursor)
    const secondCursor = advanceStaleRunCleanupCursor(
      second,
      firstCursor,
      false,
      true,
    )
    const third = selectStaleScheduledRunBatch(heartbeats, 10, secondCursor)

    expect(first).toHaveLength(10)
    expect(second).toHaveLength(10)
    expect(third).toHaveLength(10)
    expect(
      new Set([...first, ...second, ...third].map((run) => run.id)),
    ).toEqual(new Set(heartbeats.map((run) => run.id)))
  })

  it('stays fair when orphan counts vary and heartbeat capacity alternates', () => {
    const heartbeats = Array.from({ length: 100 }, (_, index) => ({
      id: `heartbeat-${String(index).padStart(3, '0')}`,
      conversationId: `conversation-${index}`,
    }))

    const visited = new Set<string>()
    let cursor: StaleRunCleanupCursor = {}
    for (let pass = 0; pass < heartbeats.length; pass += 1) {
      const orphanCount = pass % 2 === 0 ? 9 : 8
      const orphans = Array.from({ length: orphanCount }, (_, index) => ({
        id: `orphan-${index}`,
      }))
      const batch = selectStaleScheduledRunBatch(
        [...heartbeats, ...orphans],
        10,
        cursor,
      )
      expect(batch.filter((run) => run.id.startsWith('orphan-'))).toHaveLength(
        Math.min(orphanCount, 9),
      )
      const selectedHeartbeats = batch.filter((run) =>
        run.id.startsWith('heartbeat-'),
      )
      expect(selectedHeartbeats).toHaveLength(10 - Math.min(orphanCount, 9))
      selectedHeartbeats.forEach((run) => {
        visited.add(run.id)
      })
      cursor = advanceStaleRunCleanupCursor(
        batch,
        cursor,
        orphanCount > 0,
        true,
      )
    }

    expect(visited).toEqual(new Set(heartbeats.map((run) => run.id)))
  })

  it('rotates heartbeat checks despite ten or more persistent orphans', () => {
    const heartbeats = Array.from({ length: 23 }, (_, index) => ({
      id: `heartbeat-${String(index).padStart(2, '0')}`,
      conversationId: `conversation-${index}`,
    }))
    const orphans: Array<{ id: string; conversationId?: string }> = Array.from(
      { length: 12 },
      (_, index) => ({
        id: `orphan-${String(index).padStart(2, '0')}`,
      }),
    )

    const visited = new Set<string>()
    let cursor: StaleRunCleanupCursor = {}
    const visitedOrphans = new Set<string>()
    for (let pass = 0; pass < heartbeats.length; pass += 1) {
      const batch = selectStaleScheduledRunBatch(
        [...orphans, ...heartbeats],
        10,
        cursor,
      )
      const selectedHeartbeats = batch.filter((run) =>
        Boolean(run.conversationId),
      )
      expect(batch.filter((run) => !run.conversationId)).toHaveLength(9)
      expect(selectedHeartbeats).toHaveLength(1)
      selectedHeartbeats.forEach((run) => {
        visited.add(run.id)
      })
      batch
        .filter((run) => !run.conversationId)
        .forEach((run) => {
          visitedOrphans.add(run.id)
        })
      cursor = advanceStaleRunCleanupCursor(batch, cursor, true, true)
    }

    expect(visited).toEqual(new Set(heartbeats.map((run) => run.id)))
    expect(visitedOrphans).toEqual(new Set(orphans.map((run) => run.id)))
  })

  it('alternates fairly between persistent classes with a one-item limit', () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `orphan-${index}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `heartbeat-${index}`,
        conversationId: `conversation-${index}`,
      })),
    ]
    const visited = new Set<string>()
    let cursor: StaleRunCleanupCursor = {}

    for (let pass = 0; pass < 10; pass += 1) {
      const batch = selectStaleScheduledRunBatch(candidates, 1, cursor)
      expect(batch).toHaveLength(1)
      const selected = batch[0]
      if (selected) visited.add(selected.id)
      cursor = advanceStaleRunCleanupCursor(batch, cursor, true, true)
    }

    expect(visited).toEqual(new Set(candidates.map((run) => run.id)))
  })

  it('uses a stable sorted window and advances when the cursor candidate disappears', () => {
    const candidates = [
      { id: 'heartbeat-c', conversationId: 'c' },
      { id: 'heartbeat-a', conversationId: 'a' },
      { id: 'heartbeat-b', conversationId: 'b' },
    ]

    expect(
      selectStaleScheduledRunBatch(candidates, 2).map((r) => r.id),
    ).toEqual(['heartbeat-a', 'heartbeat-b'])
    const heartbeatCursor = { afterHeartbeatRunId: 'heartbeat-b' }
    expect(
      selectStaleScheduledRunBatch(candidates, 2, heartbeatCursor),
    ).toEqual(
      selectStaleScheduledRunBatch(
        [...candidates].reverse(),
        2,
        heartbeatCursor,
      ),
    )
    expect(
      selectStaleScheduledRunBatch(
        [
          candidates[0],
          candidates[2],
          { id: 'heartbeat-d', conversationId: 'd' },
        ],
        1,
        { afterHeartbeatRunId: 'heartbeat-b' },
      ).map((run) => run.id),
    ).toEqual(['heartbeat-c'])
    expect(
      selectStaleScheduledRunBatch(
        [
          candidates[0],
          candidates[2],
          { id: 'heartbeat-d', conversationId: 'd' },
        ],
        1,
        { afterHeartbeatRunId: 'heartbeat-c' },
      ).map((run) => run.id),
    ).toEqual(['heartbeat-d'])
    expect(
      selectStaleScheduledRunBatch(candidates, 2, {
        afterHeartbeatRunId: 'removed-run',
      }).map((run) => run.id),
    ).toEqual(['heartbeat-a', 'heartbeat-b'])
  })
})
