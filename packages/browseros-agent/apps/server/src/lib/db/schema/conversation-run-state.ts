/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const conversationRunState = sqliteTable(
  'conversation_run_state',
  {
    conversationId: text('conversation_id').primaryKey(),
    runId: text('run_id').notNull(),
    status: text('status').notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    tracePersistenceDegraded: integer('trace_persistence_degraded', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
  },
  (table) => [index('conversation_run_state_status_idx').on(table.status)],
)

/** Opt-in, bounded display-only recovery text; never used as conversation input. */
export const conversationRunTextCheckpoints = sqliteTable(
  'conversation_run_text_checkpoints',
  {
    conversationId: text('conversation_id').primaryKey().notNull(),
    runId: text('run_id').notNull(),
    text: text('text').notNull().default(''),
  },
  (table) => [
    check(
      'conversation_run_text_checkpoints_text_bytes_check',
      sql`length(CAST(${table.text} AS BLOB)) <= 16384`,
    ),
  ],
)

export type ConversationRunStateRow = InferSelectModel<
  typeof conversationRunState
>
export type NewConversationRunStateRow = InferInsertModel<
  typeof conversationRunState
>
