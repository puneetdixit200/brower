/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

export const conversationRunTraceEvents = sqliteTable(
  'conversation_run_trace_events',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    conversationId: text('conversation_id').notNull(),
    runId: text('run_id').notNull(),
    eventId: text('event_id').notNull(),
    eventJson: text('event_json').notNull(),
  },
  (table) => [
    unique('conversation_run_trace_events_event_id_unique').on(table.eventId),
    index('conversation_run_trace_events_scope_idx').on(
      table.conversationId,
      table.runId,
      table.sequence,
    ),
  ],
)

export type ConversationRunTraceEventRow = InferSelectModel<
  typeof conversationRunTraceEvents
>
export type NewConversationRunTraceEventRow = InferInsertModel<
  typeof conversationRunTraceEvents
>
