/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type BrowserOsDatabase, getDb } from '../db'
import {
  type NewScheduledJobRunRow,
  type ScheduledJobRunRow,
  scheduledJobOccurrenceClaims,
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
  occurrenceKey?: string | null
}

export type ScheduledJobRunStartOutcome =
  | { kind: 'started'; run: ScheduledJobRunRow }
  | { kind: 'occurrence_already_claimed' }
  | { kind: 'stale_occurrence' }
  | { kind: 'invalid_occurrence' }
  | { kind: 'conflict' }

export const OCCURRENCE_REPLAY_HORIZON_MS = 30 * 24 * 60 * 60 * 1000
const MAX_FUTURE_OCCURRENCE_SKEW_MS = 5 * 60 * 1000

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
  /** Claims a run while preserving the reason a scheduled occurrence was denied. */
  startWithOutcome(
    row: ScheduledJobRunUpsert,
  ): Promise<ScheduledJobRunStartOutcome>
  /** Finish a claimed run without allowing its durable identity to change. */
  finish(row: ScheduledJobRunUpsert): Promise<ScheduledJobRunRow | null>
  remove(id: string): Promise<ScheduledJobRunRemoval>
  /** Drops all but the newest `keep` runs of a job. Returns how many went. */
  prune(jobId: string, keep?: number): Promise<number>
}

type DatabaseProvider = () => BrowserOsDatabase
type ScheduledJobRunTransaction = Parameters<
  Parameters<BrowserOsDatabase['transaction']>[0]
>[0]

async function list(
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunRow[]> {
  return database()
    .select()
    .from(scheduledJobRuns)
    .orderBy(desc(scheduledJobRuns.startedAt))
    .all()
}

async function get(
  id: string,
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunRow | null> {
  const [row] = await database()
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.id, id))
    .limit(1)
  return row ?? null
}

async function upsert(
  row: ScheduledJobRunUpsert,
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunRow> {
  const now = Date.now()
  const { occurrenceKey: _occurrenceKey, ...runRow } = row
  const [saved] = await database()
    .insert(scheduledJobRuns)
    .values({ ...runRow, createdAt: row.createdAt ?? now, updatedAt: now })
    .onConflictDoUpdate({
      target: scheduledJobRuns.id,
      set: { ...runRow, createdAt: undefined, updatedAt: now },
    })
    .returning()
  return saved
}

async function start(
  row: ScheduledJobRunUpsert,
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunRow | null> {
  const outcome = await startWithOutcome(row, database)
  return outcome.kind === 'started' ? outcome.run : null
}

async function startWithOutcome(
  row: ScheduledJobRunUpsert,
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunStartOutcome> {
  const { occurrenceKey, ...runRow } = row
  const scheduledAt = occurrenceKey == null ? null : Date.parse(occurrenceKey)
  if (
    occurrenceKey != null &&
    (scheduledAt == null ||
      !Number.isFinite(scheduledAt) ||
      new Date(scheduledAt).toISOString() !== occurrenceKey)
  ) {
    return { kind: 'invalid_occurrence' }
  }

  // Acquire SQLite's write reservation before reading job identity. This
  // prevents a concurrent job update from changing the conversation between
  // validation and inserting the run.
  return database().transaction(
    (tx) => startInTransaction(tx, row, runRow, occurrenceKey, scheduledAt),
    { behavior: 'immediate' },
  )
}

function startInTransaction(
  tx: ScheduledJobRunTransaction,
  row: ScheduledJobRunUpsert,
  runRow: Omit<ScheduledJobRunUpsert, 'occurrenceKey'>,
  occurrenceKey: string | null | undefined,
  scheduledAt: number | null,
): ScheduledJobRunStartOutcome {
  const job = tx
    .select({
      mode: scheduledJobs.mode,
      conversationId: scheduledJobs.conversationId,
    })
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, row.jobId))
    .get()
  if (
    !job ||
    (job.mode === 'heartbeat' &&
      (!job.conversationId || job.conversationId !== row.conversationId))
  ) {
    return { kind: 'conflict' }
  }

  const now = Date.now()
  const occurrenceError = validateScheduledOccurrenceAge(scheduledAt, now)
  if (occurrenceError) return occurrenceError
  cleanupExpiredOccurrenceClaims(tx, now)

  const existingRun = tx
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.id, row.id))
    .get()
  if (existingRun && !isSameRunningRun(existingRun, row)) {
    return { kind: 'conflict' }
  }
  if (existingRun && occurrenceKey == null) {
    const claim = tx
      .select({ runId: scheduledJobOccurrenceClaims.runId })
      .from(scheduledJobOccurrenceClaims)
      .where(eq(scheduledJobOccurrenceClaims.runId, row.id))
      .get()
    return claim ? { kind: 'conflict' } : { kind: 'started', run: existingRun }
  }

  if (occurrenceKey != null && scheduledAt != null) {
    const outcome = claimOccurrence(
      tx,
      row,
      occurrenceKey,
      scheduledAt,
      now,
      existingRun,
    )
    if (outcome) return outcome
  }

  const saved = tx
    .insert(scheduledJobRuns)
    .values({
      ...runRow,
      status: 'running',
      createdAt: row.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .get()
  if (saved) return { kind: 'started', run: saved }

  if (occurrenceKey != null) {
    deleteOccurrenceClaim(tx, row.jobId, occurrenceKey, row.id)
  }
  return { kind: 'conflict' }
}

export function validateScheduledOccurrenceAge(
  scheduledAt: number | null,
  now: number,
): ScheduledJobRunStartOutcome | null {
  if (scheduledAt == null) return null
  if (scheduledAt <= now - OCCURRENCE_REPLAY_HORIZON_MS) {
    return { kind: 'stale_occurrence' }
  }
  if (scheduledAt > now + MAX_FUTURE_OCCURRENCE_SKEW_MS) {
    return { kind: 'invalid_occurrence' }
  }
  return null
}

function cleanupExpiredOccurrenceClaims(
  tx: ScheduledJobRunTransaction,
  now: number,
): void {
  // Stale-key validation prevents replay after expiry. Keeping claims for
  // active rows also preserves their completion identity if execution is slow.
  tx.run(sql`
    DELETE FROM scheduled_job_occurrence_claims
    WHERE expires_at <= ${now}
      AND run_id NOT IN (
        SELECT id FROM scheduled_job_runs WHERE status = 'running'
      )
  `)
}

function isSameRunningRun(
  existingRun: ScheduledJobRunRow,
  row: ScheduledJobRunUpsert,
): boolean {
  return (
    existingRun.jobId === row.jobId &&
    existingRun.status === 'running' &&
    existingRun.startedAt === row.startedAt &&
    (existingRun.conversationId ?? null) === (row.conversationId ?? null)
  )
}

function claimOccurrence(
  tx: ScheduledJobRunTransaction,
  row: ScheduledJobRunUpsert,
  occurrenceKey: string,
  scheduledAt: number,
  now: number,
  existingRun: ScheduledJobRunRow | undefined,
): ScheduledJobRunStartOutcome | null {
  const claim = tx
    .select()
    .from(scheduledJobOccurrenceClaims)
    .where(
      and(
        eq(scheduledJobOccurrenceClaims.jobId, row.jobId),
        eq(scheduledJobOccurrenceClaims.occurrenceKey, occurrenceKey),
      ),
    )
    .get()
  if (claim) {
    if (claim.runId === row.id && existingRun?.status === 'running') {
      return { kind: 'started', run: existingRun }
    }
    return { kind: 'occurrence_already_claimed' }
  }

  const claimed = tx
    .insert(scheduledJobOccurrenceClaims)
    .values({
      jobId: row.jobId,
      occurrenceKey,
      runId: row.id,
      expiresAt: scheduledAt + OCCURRENCE_REPLAY_HORIZON_MS,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .get()
  return claimed ? null : { kind: 'occurrence_already_claimed' }
}

function deleteOccurrenceClaim(
  tx: ScheduledJobRunTransaction,
  jobId: string,
  occurrenceKey: string,
  runId: string,
): void {
  tx.delete(scheduledJobOccurrenceClaims)
    .where(
      and(
        eq(scheduledJobOccurrenceClaims.jobId, jobId),
        eq(scheduledJobOccurrenceClaims.occurrenceKey, occurrenceKey),
        eq(scheduledJobOccurrenceClaims.runId, runId),
      ),
    )
    .run()
}

async function finish(
  row: ScheduledJobRunUpsert,
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunRow | null> {
  if (row.status === 'running') return null

  const matchingClaim =
    row.occurrenceKey == null
      ? null
      : await database()
          .select({ runId: scheduledJobOccurrenceClaims.runId })
          .from(scheduledJobOccurrenceClaims)
          .where(
            and(
              eq(scheduledJobOccurrenceClaims.jobId, row.jobId),
              eq(scheduledJobOccurrenceClaims.occurrenceKey, row.occurrenceKey),
              eq(scheduledJobOccurrenceClaims.runId, row.id),
            ),
          )
          .get()
  const anyClaimForRun = await database()
    .select({ runId: scheduledJobOccurrenceClaims.runId })
    .from(scheduledJobOccurrenceClaims)
    .where(eq(scheduledJobOccurrenceClaims.runId, row.id))
    .get()
  if (
    (row.occurrenceKey == null && anyClaimForRun) ||
    (row.occurrenceKey != null && !matchingClaim)
  ) {
    return null
  }

  const identity = [
    eq(scheduledJobRuns.id, row.id),
    eq(scheduledJobRuns.jobId, row.jobId),
    eq(scheduledJobRuns.startedAt, row.startedAt),
    row.conversationId == null
      ? isNull(scheduledJobRuns.conversationId)
      : eq(scheduledJobRuns.conversationId, row.conversationId),
  ]

  const [saved] = await database()
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
  const existing = await get(row.id, database)
  const sameRunIdentity =
    existing?.jobId === row.jobId &&
    existing.status === row.status &&
    existing.startedAt === row.startedAt &&
    (existing.conversationId ?? null) === (row.conversationId ?? null)
  if (sameRunIdentity) {
    return existing
  }
  return null
}

async function prune(
  jobId: string,
  keep: number = MAX_RUNS_PER_JOB,
  database: DatabaseProvider = getDb,
): Promise<number> {
  const rows = await database()
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

  await database()
    .delete(scheduledJobRuns)
    .where(inArray(scheduledJobRuns.id, stale))
  return stale.length
}

async function remove(
  id: string,
  database: DatabaseProvider = getDb,
): Promise<ScheduledJobRunRemoval> {
  const deleted = await database()
    .delete(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.id, id),
        inArray(scheduledJobRuns.status, ['completed', 'failed']),
      ),
    )
    .returning({ id: scheduledJobRuns.id })
  if (deleted.length > 0) return 'removed'
  const existing = await get(id, database)
  return existing?.status === 'running' ? 'running' : 'missing'
}

/** Creates a store bound to a specific database handle, useful for isolated runtimes and multi-handle checks. */
export function createScheduledJobRunStore(
  database: DatabaseProvider,
): ScheduledJobRunStore {
  return {
    list: () => list(database),
    get: (id) => get(id, database),
    upsert: (row) => upsert(row, database),
    start: (row) => start(row, database),
    startWithOutcome: (row) => startWithOutcome(row, database),
    finish: (row) => finish(row, database),
    remove: (id) => remove(id, database),
    prune: (jobId, keep) => prune(jobId, keep, database),
  }
}

export const dbScheduledJobRunStore = createScheduledJobRunStore(getDb)
