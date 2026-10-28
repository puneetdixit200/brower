/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ConversationRunStatus } from '@browseros/shared/schemas/conversation-panels'
import { getDbHandle } from '../db'

export interface DurableConversationRun {
  conversationId: string
  runId: string
  status: ConversationRunStatus
  startedAt: number
  finishedAt: number | null
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
  delete(conversationId: string): boolean
}

type RunRow = {
  conversation_id: string
  run_id: string
  status: ConversationRunStatus
  started_at: number
  finished_at: number | null
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
        `INSERT INTO conversation_run_state (conversation_id, run_id, status, started_at, finished_at)
       VALUES (?, ?, 'running', ?, NULL)
       ON CONFLICT(conversation_id) DO UPDATE SET run_id = excluded.run_id, status = 'running', started_at = excluded.started_at, finished_at = NULL`,
      )
      .run(conversationId, runId, startedAt)
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
        'SELECT conversation_id, run_id, status, started_at, finished_at FROM conversation_run_state WHERE conversation_id = ?',
      )
      .get(conversationId)
    if (!row) return undefined
    return {
      conversationId: row.conversation_id,
      runId: row.run_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }
  }

  delete(conversationId: string): boolean {
    return (
      getDbHandle()
        .sqlite.prepare(
          'DELETE FROM conversation_run_state WHERE conversation_id = ?',
        )
        .run(conversationId).changes > 0
    )
  }
}
