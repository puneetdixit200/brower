/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import {
  type NewScheduledJobRunRow,
  type ScheduledJobRunRow,
  scheduledJobRuns,
  scheduledJobs,
} from '../db/schema'

/**
 * The store stamps `updatedAt` and defaults `createdAt`, so callers supply
 * neither. `createdAt` stays optional so an import can preserve the original
 * creation time when it has one.
 */
export type ScheduledJobRunUpsert = Omit<
  NewScheduledJobRunRow,
  'updatedAt' | 'createdAt'
> & {
  createdAt?: number
}

/**
 * Runs kept per job. The extension applied this cap when it owned the history,
 * trimming as it created each run; keeping the number here means it holds
 * however the run was written rather than only on the path that happened to
 * enforce it.
 */
export const MAX_RUNS_PER_JOB = 15

export type ScheduledJobRunRemoval = 'removed' | 'running' | 'missing'

export interface ScheduledJobRunStore {
  list(): Promise<ScheduledJobRunRow[]>
  get(id: string): Promise<ScheduledJobRunRow | null>
  /** Insert or replace by id for additive imports and repair operations. */
  upsert(row: ScheduledJobRunUpsert): Promise<ScheduledJobRunRow>
  /** Atomically claim the job's single running slot. Null means another run owns it. */
  start(row: ScheduledJobRunUpsert): Promise<ScheduledJobRunRow | null>
  /** Finish a claimed run without allowing its durable identity to change. */
  finish(row: ScheduledJobRunUpsert): Promise<ScheduledJobRunRow | null>
  remove(id: string): Promise<ScheduledJobRunRemoval>
  /** Drops all but the newest `keep` runs of a job. Returns how many went. */
  prune(jobId: string, keep?: number): Promise<number>
}

async function list(): Promise<ScheduledJobRunRow[]> {
  return getDb()
    .select()
    .from(scheduledJobRuns)
    .orderBy(desc(scheduledJobRuns.startedAt))
    .all()
}

async function get(id: string): Promise<ScheduledJobRunRow | null> {
  const [row] = await getDb()
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.id, id))
    .limit(1)
  return row ?? null
}

async function upsert(row: ScheduledJobRunUpsert): Promise<ScheduledJobRunRow> {
  const now = Date.now()
  const [saved] = await getDb()
    .insert(scheduledJobRuns)
    .values({ ...row, createdAt: row.createdAt ?? now, updatedAt: now })
    .onConflictDoUpdate({
      target: scheduledJobRuns.id,
      set: { ...row, createdAt: undefined, updatedAt: now },
    })
    .returning()
  return saved
}

async function start(
  row: ScheduledJobRunUpsert,
): Promise<ScheduledJobRunRow | null> {
  // Acquire SQLite's write reservation before reading job identity. This
  // prevents a concurrent job update from changing the conversation between
  // validation and inserting the run.
  return getDb().transaction(
    (tx) => {
      const job = tx
        .select({
          mode: scheduledJobs.mode,
          conversationId: scheduledJobs.conversationId,
        })
        .from(scheduledJobs)
        .where(eq(scheduledJobs.id, row.jobId))
        .get()

      if (!job) return null

      // Heartbeat identity is owned by the saved job. A run cannot silently
      // fork the transcript or create one before the job has a durable conversation.
      if (
        job?.mode === 'heartbeat' &&
        (!job.conversationId || job.conversationId !== row.conversationId)
      ) {
        return null
      }

      const now = Date.now()
      const saved = tx
        .insert(scheduledJobRuns)
        .values({
          ...row,
          status: 'running',
          createdAt: row.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning()
        .get()
      if (saved) return saved

      // The PUT can be retried after the insert committed but its response was
      // lost. Treat only the same still-running run as an idempotent retry.
      const existing = tx
        .select()
        .from(scheduledJobRuns)
        .where(eq(scheduledJobRuns.id, row.id))
        .get()
      if (
        existing?.jobId === row.jobId &&
        existing.status === 'running' &&
        existing.startedAt === row.startedAt &&
        (existing.conversationId ?? null) === (row.conversationId ?? null)
      ) {
        return existing
      }
      return null
    },
    { behavior: 'immediate' },
  )
}

async function finish(
  row: ScheduledJobRunUpsert,
): Promise<ScheduledJobRunRow | null> {
  if (row.status === 'running') return null

  const identity = [
    eq(scheduledJobRuns.id, row.id),
    eq(scheduledJobRuns.jobId, row.jobId),
    eq(scheduledJobRuns.startedAt, row.startedAt),
    row.conversationId == null
      ? isNull(scheduledJobRuns.conversationId)
      : eq(scheduledJobRuns.conversationId, row.conversationId),
  ]

  const [saved] = await getDb()
    .update(scheduledJobRuns)
    .set({
      status: row.status,
      completedAt: row.completedAt ?? null,
      result: row.result ?? null,
      finalResult: row.finalResult ?? null,
      executionLog: row.executionLog ?? null,
      toolCalls: row.toolCalls ?? null,
      error: row.error ?? null,
      updatedAt: Date.now(),
    })
    .where(and(...identity, eq(scheduledJobRuns.status, 'running')))
    .returning()

  if (saved) return saved

  // A completion PUT may be retried after its response was lost. Return the
  // terminal row unchanged only when it has the exact same identity/state.
  const existing = await get(row.id)
  if (
    existing?.jobId === row.jobId &&
    existing.status === row.status &&
    existing.startedAt === row.startedAt &&
    (existing.conversationId ?? null) === (row.conversationId ?? null)
  ) {
    return existing
  }
  return null
}

async function prune(
  jobId: string,
  keep: number = MAX_RUNS_PER_JOB,
): Promise<number> {
  const rows = await getDb()
    .select({ id: scheduledJobRuns.id, status: scheduledJobRuns.status })
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.jobId, jobId))
    .orderBy(desc(scheduledJobRuns.startedAt))
    .all()

  // A live execution owns the unique per-job slot. Retention must never
  // delete that claim just because its client-provided start time sorts old.
  const terminalRows = rows.filter((row) => row.status !== 'running')
  const stale = terminalRows.slice(keep).map((row) => row.id)
  if (stale.length === 0) return 0

  await getDb()
    .delete(scheduledJobRuns)
    .where(inArray(scheduledJobRuns.id, stale))
  return stale.length
}

async function remove(id: string): Promise<ScheduledJobRunRemoval> {
  const deleted = await getDb()
    .delete(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.id, id),
        inArray(scheduledJobRuns.status, ['completed', 'failed']),
      ),
    )
    .returning({ id: scheduledJobRuns.id })
  if (deleted.length > 0) return 'removed'
  const existing = await get(id)
  return existing?.status === 'running' ? 'running' : 'missing'
}

export const dbScheduledJobRunStore: ScheduledJobRunStore = {
  list,
  get,
  upsert,
  start,
  finish,
  remove,
  prune,
}
