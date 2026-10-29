/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Replay tombstones for side-effecting provider tool calls. Keys are opaque hashes. */
export const toolOperationClaims = sqliteTable(
  'tool_operation_claims',
  {
    claimKey: text('claim_key').primaryKey(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('tool_operation_claims_expires_at_idx').on(table.expiresAt),
  ],
)
