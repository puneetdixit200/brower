/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Bounded snapshots of note states, used only for explicit user undo. */
export const memoryRevisions = sqliteTable(
  'memory_revisions',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    memoryId: text('memory_id').notNull(),
    content: text('content').notNull(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    sourceId: text('source_id'),
    sourceTitle: text('source_title'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('memory_revisions_memory_sequence_idx').on(
      table.memoryId,
      table.sequence,
    ),
  ],
)
