/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One-use approval bindings. Every identifier and input value is stored as a digest. */
export const approvalOperationGrants = sqliteTable(
  'approval_operation_grants',
  {
    operationHash: text('operation_hash').primaryKey(),
    taskHash: text('task_hash').notNull(),
    approvalHash: text('approval_hash').notNull(),
    toolCallHash: text('tool_call_hash').notNull(),
    classificationHash: text('classification_hash').notNull(),
    inputHash: text('input_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
  },
  (table) => [
    index('approval_operation_grants_expiry_idx').on(table.expiresAt),
  ],
)
