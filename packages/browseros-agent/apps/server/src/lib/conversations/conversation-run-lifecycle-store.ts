/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ConversationRunStatus } from '@browseros/shared/schemas/conversation-panels'
import {
  type AgentTaskTraceEvent,
  AgentTaskTraceEventSchema,
  createAgentTaskTraceEvent,
} from '../../agent/task-contract'
import { getDbHandle } from '../db'
import { capPartialAssistantTextUtf8 } from './partial-assistant-text'

const MAX_TRACE_EVENTS_PER_RUN = 500
const MAX_TRACE_EVENTS_TOTAL = 10_000

export interface DurableConversationRun {
  conversationId: string
  runId: string
  status: ConversationRunStatus
  startedAt: number
  finishedAt: number | null
  tracePersistenceDegraded: boolean
}

export type HumanWaitPhase =
  | 'waiting'
  | 'human_completed'
  | 'cancelled'
  | 'interrupted'

export interface DurableHumanWait {
  conversationId: string
  runId: string
  requestId: string
  phase: HumanWaitPhase
  createdAt: number
  updatedAt: number
  completedAt: number | null
  version: number
}

/** Stores lifecycle metadata and opt-in, bounded assistant display text only; prompts, user messages, credentials, reasoning, and tool I/O stay transient. */
export interface ConversationRunLifecycleStore {
  start(
    conversationId: string,
    runId: string,
    startedAt: number,
    persistPartialTranscript?: boolean,
  ): void
  appendPartialAssistantText?(
    conversationId: string,
    runId: string,
    delta: string,
  ): void
  getPartialAssistantText?(
    conversationId: string,
    runId: string,
  ): string | undefined
  finish(
    conversationId: string,
    runId: string,
    status: Exclude<ConversationRunStatus, 'running'>,
    finishedAt: number,
  ): void
  get(conversationId: string): DurableConversationRun | undefined
  appendTraceEvent(
    conversationId: string,
    runId: string,
    event: AgentTaskTraceEvent,
  ): void
  markTracePersistenceDegraded(conversationId: string, runId: string): void
  ensureInterruptionTraceEvent(
    conversationId: string,
    runId: string,
    at: number,
  ): AgentTaskTraceEvent
  getTraceEvents(conversationId: string, runId: string): AgentTaskTraceEvent[]
  /** Persists opaque identity only, and only while this exact run is active. */
  beginHumanWait(
    conversationId: string,
    runId: string,
    requestId: string,
    at: number,
  ): DurableHumanWait | undefined
  getHumanWait(
    conversationId: string,
    runId: string,
  ): DurableHumanWait | undefined
  getCurrentHumanWait?(conversationId: string): DurableHumanWait | undefined
  /** Atomically consumes an interrupted wait for one fresh conversation authorization. */
  authorizeFreshConversation?(
    conversationId: string,
    runId: string,
    requestId: string,
    freshConversationId: string,
  ): string | undefined
  /** CAS: true only for the first exact active-run/request completion. */
  completeHumanWait(
    conversationId: string,
    runId: string,
    requestId: string,
    at: number,
  ): boolean
  cancelHumanWait(
    conversationId: string,
    runId: string,
    requestId: string,
    at: number,
  ): boolean
  delete(conversationId: string): boolean
}

type RunRow = {
  conversation_id: string
  run_id: string
  status: ConversationRunStatus
  started_at: number
  finished_at: number | null
  trace_persistence_degraded: number
}

type TraceEventRow = {
  event_id: string
  event_json: string
}

type HumanWaitRow = {
  conversation_id: string
  run_id: string
  request_id: string
  phase: HumanWaitPhase
  created_at: number
  updated_at: number
  completed_at: number | null
  version: number
}

function decodeHumanWait(row: HumanWaitRow): DurableHumanWait {
  return {
    conversationId: row.conversation_id,
    runId: row.run_id,
    requestId: row.request_id,
    phase: row.phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    version: row.version,
  }
}

function decodeTraceEventRow(row: TraceEventRow, runId: string) {
  let decoded: unknown
  try {
    decoded = JSON.parse(row.event_json)
  } catch {
    throw new Error('Stored conversation run trace event is invalid JSON')
  }
  const event = AgentTaskTraceEventSchema.parse(decoded)
  if (event.eventId !== row.event_id || event.taskId !== runId) {
    throw new Error('Stored conversation run trace event scope is invalid')
  }
  return event
}

/** Reconciles orphaned runs when the API process starts; it never resumes execution. */
export class DbConversationRunLifecycleStore
  implements ConversationRunLifecycleStore
{
  constructor() {
    const sqlite = getDbHandle().sqlite
    sqlite.transaction(() => {
      sqlite
        .prepare(
          "UPDATE conversation_run_state SET status = 'interrupted', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'",
        )
        .run(Date.now())
      sqlite
        .prepare(
          `UPDATE conversation_human_waits SET phase = 'interrupted', updated_at = ?, version = version + 1
         WHERE phase = 'waiting' AND EXISTS (
           SELECT 1 FROM conversation_run_state s
           WHERE s.conversation_id = conversation_human_waits.conversation_id
             AND s.run_id = conversation_human_waits.run_id AND s.status = 'interrupted'
         )`,
        )
        .run(Date.now())
    })()
  }

  start(
    conversationId: string,
    runId: string,
    startedAt: number,
    persistPartialTranscript = false,
  ): void {
    const sqlite = getDbHandle().sqlite
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO conversation_run_state (conversation_id, run_id, status, started_at, finished_at, trace_persistence_degraded)
       VALUES (?, ?, 'running', ?, NULL, 0)
       ON CONFLICT(conversation_id) DO UPDATE SET run_id = excluded.run_id, status = 'running', started_at = excluded.started_at, finished_at = NULL, trace_persistence_degraded = 0`,
        )
        .run(conversationId, runId, startedAt)
      sqlite
        .prepare(
          `UPDATE conversation_human_waits SET phase = 'interrupted', updated_at = ?, version = version + 1
         WHERE conversation_id = ? AND phase = 'waiting' AND run_id <> ?`,
        )
        .run(startedAt, conversationId, runId)
      try {
        sqlite
          .prepare(
            'DELETE FROM conversation_run_text_checkpoints WHERE conversation_id = ?',
          )
          .run(conversationId)
        if (persistPartialTranscript) {
          sqlite
            .prepare(
              'INSERT INTO conversation_run_text_checkpoints (conversation_id, run_id, text) VALUES (?, ?, ?)',
            )
            .run(conversationId, runId, '')
        }
      } catch {
        // Checkpoint storage is optional and must not block run startup.
      }
    })()
  }

  appendPartialAssistantText(
    conversationId: string,
    runId: string,
    delta: string,
  ): void {
    if (!delta) return
    const sqlite = getDbHandle().sqlite
    sqlite.transaction(() => {
      const row = sqlite
        .query<{ text: string }, [string, string]>(
          `SELECT c.text FROM conversation_run_text_checkpoints c
           JOIN conversation_run_state s ON s.conversation_id = c.conversation_id AND s.run_id = c.run_id
           WHERE c.conversation_id = ? AND c.run_id = ? AND s.status = 'running'`,
        )
        .get(conversationId, runId)
      if (!row) return
      const next = capPartialAssistantTextUtf8(row.text + delta)
      sqlite
        .prepare(
          `UPDATE conversation_run_text_checkpoints SET text = ?
           WHERE conversation_id = ? AND run_id = ?
             AND EXISTS (SELECT 1 FROM conversation_run_state s
               WHERE s.conversation_id = ? AND s.run_id = ? AND s.status = 'running')`,
        )
        .run(next, conversationId, runId, conversationId, runId)
    })()
  }

  getPartialAssistantText(
    conversationId: string,
    runId: string,
  ): string | undefined {
    const row = getDbHandle()
      .sqlite.query<{ text: string }, [string, string]>(
        `SELECT c.text FROM conversation_run_text_checkpoints c
         JOIN conversation_run_state s ON s.conversation_id = c.conversation_id AND s.run_id = c.run_id
         WHERE c.conversation_id = ? AND c.run_id = ?`,
      )
      .get(conversationId, runId)
    return row?.text || undefined
  }

  markTracePersistenceDegraded(conversationId: string, runId: string): void {
    getDbHandle()
      .sqlite.prepare(
        'UPDATE conversation_run_state SET trace_persistence_degraded = 1 WHERE conversation_id = ? AND run_id = ?',
      )
      .run(conversationId, runId)
  }

  finish(
    conversationId: string,
    runId: string,
    status: Exclude<ConversationRunStatus, 'running'>,
    finishedAt: number,
  ): void {
    const sqlite = getDbHandle().sqlite
    sqlite.transaction(() => {
      const result = sqlite
        .prepare(
          "UPDATE conversation_run_state SET status = ?, finished_at = ? WHERE conversation_id = ? AND run_id = ? AND status = 'running'",
        )
        .run(status, finishedAt, conversationId, runId)
      if (result.changes > 0) {
        sqlite
          .prepare(
            `UPDATE conversation_human_waits SET phase = 'interrupted', updated_at = ?, version = version + 1
           WHERE conversation_id = ? AND run_id = ? AND phase = 'waiting'`,
          )
          .run(finishedAt, conversationId, runId)
        if (status !== 'interrupted') {
          try {
            sqlite
              .prepare(
                'DELETE FROM conversation_run_text_checkpoints WHERE conversation_id = ? AND run_id = ?',
              )
              .run(conversationId, runId)
          } catch {
            // Keep execution completion independent of optional checkpoint cleanup.
          }
        }
      }
    })()
  }

  get(conversationId: string): DurableConversationRun | undefined {
    const row = getDbHandle()
      .sqlite.query<RunRow, [string]>(
        'SELECT conversation_id, run_id, status, started_at, finished_at, trace_persistence_degraded FROM conversation_run_state WHERE conversation_id = ?',
      )
      .get(conversationId)
    if (!row) return undefined
    return {
      conversationId: row.conversation_id,
      runId: row.run_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      tracePersistenceDegraded: row.trace_persistence_degraded === 1,
    }
  }

  appendTraceEvent(
    conversationId: string,
    runId: string,
    event: AgentTaskTraceEvent,
  ): void {
    const validated = AgentTaskTraceEventSchema.parse(event)
    if (validated.taskId !== runId) {
      throw new Error('Trace event taskId must match its conversation runId')
    }

    const sqlite = getDbHandle().sqlite
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO conversation_run_trace_events
             (conversation_id, run_id, event_id, event_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          conversationId,
          runId,
          validated.eventId,
          JSON.stringify(validated),
        )
      sqlite
        .prepare(
          `DELETE FROM conversation_run_trace_events
           WHERE sequence IN (
             SELECT sequence FROM conversation_run_trace_events
             WHERE conversation_id = ? AND run_id = ?
             ORDER BY sequence DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(conversationId, runId, MAX_TRACE_EVENTS_PER_RUN)
      sqlite
        .prepare(
          `DELETE FROM conversation_run_trace_events
           WHERE sequence IN (
             SELECT sequence FROM conversation_run_trace_events
             ORDER BY sequence DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(MAX_TRACE_EVENTS_TOTAL)
    })()
  }

  ensureInterruptionTraceEvent(
    conversationId: string,
    runId: string,
    at: number,
  ): AgentTaskTraceEvent {
    const candidate = createAgentTaskTraceEvent(
      { kind: 'task_interrupted' },
      { taskId: runId, at },
    )
    const sqlite = getDbHandle().sqlite
    return sqlite.transaction(() => {
      const run = sqlite
        .query<RunRow, [string]>(
          'SELECT conversation_id, run_id, status, started_at, finished_at, trace_persistence_degraded FROM conversation_run_state WHERE conversation_id = ?',
        )
        .get(conversationId)
      if (!run || run.run_id !== runId || run.status !== 'interrupted') {
        throw new Error('Cannot persist interruption trace outside its run')
      }
      const rows = sqlite
        .query<TraceEventRow, [string, string]>(
          `SELECT event_id, event_json FROM conversation_run_trace_events
           WHERE conversation_id = ? AND run_id = ? ORDER BY sequence`,
        )
        .all(conversationId, runId)
      const existing = rows
        .map((row) => decodeTraceEventRow(row, runId))
        .find((event) => event.kind === 'task_interrupted')
      if (existing) return existing

      sqlite
        .prepare(
          `INSERT INTO conversation_run_trace_events
             (conversation_id, run_id, event_id, event_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          conversationId,
          runId,
          candidate.eventId,
          JSON.stringify(candidate),
        )
      sqlite
        .prepare(
          `DELETE FROM conversation_run_trace_events
           WHERE sequence IN (
             SELECT sequence FROM conversation_run_trace_events
             WHERE conversation_id = ? AND run_id = ?
             ORDER BY sequence DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(conversationId, runId, MAX_TRACE_EVENTS_PER_RUN)
      sqlite
        .prepare(
          `DELETE FROM conversation_run_trace_events
           WHERE sequence IN (
             SELECT sequence FROM conversation_run_trace_events
             ORDER BY sequence DESC LIMIT -1 OFFSET ?
           )`,
        )
        .run(MAX_TRACE_EVENTS_TOTAL)
      return candidate
    })()
  }

  getTraceEvents(conversationId: string, runId: string): AgentTaskTraceEvent[] {
    const rows = getDbHandle()
      .sqlite.query<TraceEventRow, [string, string]>(
        `SELECT event_id, event_json FROM conversation_run_trace_events
         WHERE conversation_id = ? AND run_id = ? ORDER BY sequence`,
      )
      .all(conversationId, runId)
    return rows.map((row) => decodeTraceEventRow(row, runId))
  }

  beginHumanWait(
    conversationId: string,
    runId: string,
    requestId: string,
    at: number,
  ): DurableHumanWait | undefined {
    const sqlite = getDbHandle().sqlite
    return sqlite.transaction(() => {
      const active = sqlite
        .prepare(
          "SELECT 1 FROM conversation_run_state WHERE conversation_id = ? AND run_id = ? AND status = 'running'",
        )
        .get(conversationId, runId)
      if (!active) return undefined
      sqlite
        .prepare(
          `INSERT INTO conversation_human_waits
           (conversation_id, run_id, request_id, phase, created_at, updated_at, completed_at, version)
         VALUES (?, ?, ?, 'waiting', ?, ?, NULL, 1)
         ON CONFLICT(conversation_id, run_id) DO UPDATE SET
           request_id = excluded.request_id, phase = 'waiting', created_at = excluded.created_at,
           updated_at = excluded.updated_at, completed_at = NULL,
           version = conversation_human_waits.version + 1`,
        )
        .run(conversationId, runId, requestId, at, at)
      const row = sqlite
        .query<HumanWaitRow, [string, string]>(
          'SELECT conversation_id, run_id, request_id, phase, created_at, updated_at, completed_at, version FROM conversation_human_waits WHERE conversation_id = ? AND run_id = ?',
        )
        .get(conversationId, runId)
      return row ? decodeHumanWait(row) : undefined
    })()
  }

  getHumanWait(
    conversationId: string,
    runId: string,
  ): DurableHumanWait | undefined {
    const row = getDbHandle()
      .sqlite.query<HumanWaitRow, [string, string]>(
        'SELECT conversation_id, run_id, request_id, phase, created_at, updated_at, completed_at, version FROM conversation_human_waits WHERE conversation_id = ? AND run_id = ?',
      )
      .get(conversationId, runId)
    return row ? decodeHumanWait(row) : undefined
  }

  getCurrentHumanWait(conversationId: string): DurableHumanWait | undefined {
    const row = getDbHandle()
      .sqlite.query<HumanWaitRow, [string]>(
        `SELECT w.conversation_id, w.run_id, w.request_id, w.phase, w.created_at, w.updated_at, w.completed_at, w.version
         FROM conversation_human_waits w
         JOIN conversation_run_state s ON s.conversation_id = w.conversation_id AND s.run_id = w.run_id
         WHERE w.conversation_id = ? AND w.phase IN ('waiting', 'interrupted')
           AND ((w.phase = 'waiting' AND s.status = 'running') OR (w.phase = 'interrupted' AND s.status = 'interrupted'))`,
      )
      .get(conversationId)
    return row ? decodeHumanWait(row) : undefined
  }

  authorizeFreshConversation(
    conversationId: string,
    runId: string,
    requestId: string,
    freshConversationId: string,
  ): string | undefined {
    const sqlite = getDbHandle().sqlite
    return sqlite.transaction(() => {
      const current = sqlite
        .query<
          { fresh_conversation_id: string | null },
          [string, string, string]
        >(
          `SELECT w.fresh_conversation_id
             FROM conversation_human_waits w
             JOIN conversation_run_state s ON s.conversation_id = w.conversation_id AND s.run_id = w.run_id
             WHERE w.conversation_id = ? AND w.run_id = ? AND w.request_id = ?
               AND w.phase = 'interrupted' AND s.status = 'interrupted'`,
        )
        .get(conversationId, runId, requestId)
      if (!current) return undefined
      if (current.fresh_conversation_id) return current.fresh_conversation_id

      const updated = sqlite
        .prepare(
          `UPDATE conversation_human_waits
             SET fresh_conversation_id = ?, version = version + 1
             WHERE conversation_id = ? AND run_id = ? AND request_id = ?
               AND phase = 'interrupted' AND fresh_conversation_id IS NULL
               AND EXISTS (SELECT 1 FROM conversation_run_state s
                 WHERE s.conversation_id = ? AND s.run_id = ? AND s.status = 'interrupted')`,
        )
        .run(
          freshConversationId,
          conversationId,
          runId,
          requestId,
          conversationId,
          runId,
        )
      return updated.changes === 1 ? freshConversationId : undefined
    })()
  }

  completeHumanWait(
    conversationId: string,
    runId: string,
    requestId: string,
    at: number,
  ): boolean {
    const sqlite = getDbHandle().sqlite
    return sqlite.transaction(
      () =>
        sqlite
          .prepare(
            `UPDATE conversation_human_waits SET phase = 'human_completed', updated_at = ?, completed_at = ?, version = version + 1
         WHERE conversation_id = ? AND run_id = ? AND request_id = ? AND phase = 'waiting'
           AND EXISTS (SELECT 1 FROM conversation_run_state s
             WHERE s.conversation_id = ? AND s.run_id = ? AND s.status = 'running')`,
          )
          .run(at, at, conversationId, runId, requestId, conversationId, runId)
          .changes === 1,
    )()
  }

  cancelHumanWait(
    conversationId: string,
    runId: string,
    requestId: string,
    at: number,
  ): boolean {
    const sqlite = getDbHandle().sqlite
    return sqlite.transaction(
      () =>
        sqlite
          .prepare(
            `UPDATE conversation_human_waits SET phase = 'cancelled', updated_at = ?, version = version + 1
         WHERE conversation_id = ? AND run_id = ? AND request_id = ? AND phase = 'waiting'`,
          )
          .run(at, conversationId, runId, requestId).changes === 1,
    )()
  }

  delete(conversationId: string): boolean {
    const sqlite = getDbHandle().sqlite
    return sqlite.transaction(() => {
      const traces = sqlite
        .prepare(
          'DELETE FROM conversation_run_trace_events WHERE conversation_id = ?',
        )
        .run(conversationId).changes
      const state = sqlite
        .prepare('DELETE FROM conversation_run_state WHERE conversation_id = ?')
        .run(conversationId).changes
      const waits = sqlite
        .prepare(
          'DELETE FROM conversation_human_waits WHERE conversation_id = ?',
        )
        .run(conversationId).changes
      const text = sqlite
        .prepare(
          'DELETE FROM conversation_run_text_checkpoints WHERE conversation_id = ?',
        )
        .run(conversationId).changes
      return traces + state + waits + text > 0
    })()
  }
}
