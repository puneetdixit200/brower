/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

/** Opaque resume identity only. Never add provider, browser, challenge or user payloads here. */
export const conversationHumanWaits = sqliteTable(
  'conversation_human_waits',
  {
    conversationId: text('conversation_id').notNull(),
    runId: text('run_id').notNull(),
    requestId: text('request_id').notNull(),
    phase: text('phase', {
      enum: ['waiting', 'human_completed', 'cancelled', 'interrupted'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
    freshConversationId: text('fresh_conversation_id'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.runId] }),
    index('conversation_human_waits_phase_idx').on(table.phase),
  ],
)

export type ConversationHumanWaitRow = InferSelectModel<
  typeof conversationHumanWaits
>
export type NewConversationHumanWaitRow = InferInsertModel<
  typeof conversationHumanWaits
>
