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

/** Stores lifecycle metadata only; prompts, messages, credentials, and tool I/O stay transient. */
export interface ConversationRunLifecycleStore {
  start(conversationId: string, runId: string, startedAt: number): void
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
    getDbHandle()
      .sqlite.prepare(
        "UPDATE conversation_run_state SET status = 'interrupted', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'",
      )
      .run(Date.now())
  }

  start(conversationId: string, runId: string, startedAt: number): void {
    getDbHandle()
      .sqlite.prepare(
        `INSERT INTO conversation_run_state (conversation_id, run_id, status, started_at, finished_at, trace_persistence_degraded)
       VALUES (?, ?, 'running', ?, NULL, 0)
       ON CONFLICT(conversation_id) DO UPDATE SET run_id = excluded.run_id, status = 'running', started_at = excluded.started_at, finished_at = NULL, trace_persistence_degraded = 0`,
      )
      .run(conversationId, runId, startedAt)
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
    getDbHandle()
      .sqlite.prepare(
        "UPDATE conversation_run_state SET status = ?, finished_at = ? WHERE conversation_id = ? AND run_id = ? AND status = 'running'",
      )
      .run(status, finishedAt, conversationId, runId)
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
      return traces + state > 0
    })()
  }
}
