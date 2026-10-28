import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const actionPolicyRules = sqliteTable(
  'action_policy_rules',
  {
    actionId: text('action_id').primaryKey(),
    decision: text('decision', { enum: ['allow', 'ask', 'deny'] }).notNull(),
    expiresAt: integer('expires_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check(
      'action_policy_rules_decision_check',
      sql`${table.decision} IN ('allow', 'ask', 'deny')`,
    ),
  ],
)

export type ActionPolicyRule = InferSelectModel<typeof actionPolicyRules>
export type NewActionPolicyRule = InferInsertModel<typeof actionPolicyRules>
