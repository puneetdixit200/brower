/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Explicitly user-authored local memory. Automatic extraction is not enabled. */
export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    content: text('content').notNull(),
    source: text('source').notNull().default('user'),
    sourceUrl: text('source_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at'),
  },
  (table) => [index('memories_updated_at_idx').on(table.updatedAt)],
)

export const memorySettings = sqliteTable('memory_settings', {
  id: integer('id').primaryKey().notNull().default(1),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  retentionDays: integer('retention_days'),
  updatedAt: integer('updated_at').notNull(),
})
