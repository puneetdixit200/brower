/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod'

const OpaqueIdentitySchema = z.string().trim().min(1).max(200)
const TimestampSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

const InterruptedSnapshotSchema = z
  .object({
    conversationId: OpaqueIdentitySchema,
    runId: OpaqueIdentitySchema,
    runStatus: z.literal('interrupted'),
    waitId: OpaqueIdentitySchema,
    waitPhase: z.literal('interrupted'),
    runStartedAt: TimestampSchema,
    runFinishedAt: TimestampSchema,
    waitCreatedAt: TimestampSchema,
    waitUpdatedAt: TimestampSchema,
  })
  .strict()

const ConfirmationSchema = z
  .object({
    sourceConversationId: OpaqueIdentitySchema,
    interruptedRunId: OpaqueIdentitySchema,
    waitId: OpaqueIdentitySchema,
    confirmedAt: TimestampSchema,
    freshConversationId: z.string().uuid(),
  })
  .strict()

/**
 * A deliberately content-free boundary. This value contains no prompt,
 * transcript, tool/provider data, page state, credential, approval, or lease.
 */
export interface FreshRunCheckpoint {
  readonly kind: 'fresh_run_checkpoint'
  readonly conversationId: string
  readonly interruptedRunId: string
  readonly waitId: string
  readonly interruptedAt: number
  readonly checkpointedAt: number
  readonly requiresExplicitConfirmation: true
}

/** The only authorization produced here names a distinct conversation from scratch. */
export interface FreshConversationAuthorization {
  readonly kind: 'fresh_conversation_authorized'
  readonly sourceConversationId: string
  readonly interruptedRunId: string
  readonly waitId: string
  readonly freshConversationId: string
  readonly confirmedAt: number
  readonly carriesPriorExecutionState: false
}

export type FreshRunCheckpointResult =
  | { ok: true; checkpoint: FreshRunCheckpoint }
  | { ok: false; reason: 'invalid_or_stale_interruption' }

export type FreshConversationAuthorizationResult =
  | { ok: true; authorization: FreshConversationAuthorization }
  | {
      ok: false
      reason:
        | 'invalid_confirmation'
        | 'identity_mismatch'
        | 'duplicate_confirmation'
        | 'confirmation_before_checkpoint'
        | 'fresh_conversation_reuses_source_conversation'
    }

/**
 * Creates an explicit checkpoint only for a coherent interrupted run/wait.
 * There is intentionally no argument for transcript or execution content.
 */
export function createFreshRunCheckpoint(
  candidate: unknown,
  checkpointedAt: number,
): FreshRunCheckpointResult {
  const parsed = InterruptedSnapshotSchema.safeParse(candidate)
  if (
    !parsed.success ||
    !Number.isSafeInteger(checkpointedAt) ||
    checkpointedAt < parsed.data.runFinishedAt ||
    parsed.data.runStartedAt > parsed.data.runFinishedAt ||
    parsed.data.waitCreatedAt < parsed.data.runStartedAt ||
    parsed.data.waitCreatedAt > parsed.data.runFinishedAt ||
    parsed.data.waitUpdatedAt < parsed.data.waitCreatedAt ||
    parsed.data.waitUpdatedAt > parsed.data.runFinishedAt
  ) {
    return { ok: false, reason: 'invalid_or_stale_interruption' }
  }

  return {
    ok: true,
    checkpoint: Object.freeze({
      kind: 'fresh_run_checkpoint',
      conversationId: parsed.data.conversationId,
      interruptedRunId: parsed.data.runId,
      waitId: parsed.data.waitId,
      interruptedAt: parsed.data.runFinishedAt,
      checkpointedAt,
      requiresExplicitConfirmation: true,
    }),
  }
}

/**
 * Validates a fresh-conversation authorization decision. Callers persist its
 * one-shot consumption atomically; this pure policy rejects known duplicate use.
 * The returned value grants no permission to restore the old provider/tool
 * stack or any payload associated with the interrupted execution.
 */
export function authorizeFreshConversationCheckpoint(
  checkpoint: unknown,
  confirmation: unknown,
  checkpointConsumed: boolean,
): FreshConversationAuthorizationResult {
  if (checkpointConsumed) {
    return { ok: false, reason: 'duplicate_confirmation' }
  }
  const checkpointParsed = CheckpointSchema.safeParse(checkpoint)
  const confirmationParsed = ConfirmationSchema.safeParse(confirmation)
  if (!checkpointParsed.success || !confirmationParsed.success) {
    return { ok: false, reason: 'invalid_confirmation' }
  }

  const saved = checkpointParsed.data
  const requested = confirmationParsed.data
  if (
    requested.sourceConversationId !== saved.conversationId ||
    requested.interruptedRunId !== saved.interruptedRunId ||
    requested.waitId !== saved.waitId
  ) {
    return { ok: false, reason: 'identity_mismatch' }
  }
  if (requested.confirmedAt < saved.checkpointedAt) {
    return { ok: false, reason: 'confirmation_before_checkpoint' }
  }
  if (requested.freshConversationId === saved.conversationId) {
    return {
      ok: false,
      reason: 'fresh_conversation_reuses_source_conversation',
    }
  }

  return {
    ok: true,
    authorization: Object.freeze({
      kind: 'fresh_conversation_authorized',
      sourceConversationId: saved.conversationId,
      interruptedRunId: saved.interruptedRunId,
      waitId: saved.waitId,
      freshConversationId: requested.freshConversationId,
      confirmedAt: requested.confirmedAt,
      carriesPriorExecutionState: false,
    }),
  }
}

const CheckpointSchema = z
  .object({
    kind: z.literal('fresh_run_checkpoint'),
    conversationId: OpaqueIdentitySchema,
    interruptedRunId: OpaqueIdentitySchema,
    waitId: OpaqueIdentitySchema,
    interruptedAt: TimestampSchema,
    checkpointedAt: TimestampSchema,
    requiresExplicitConfirmation: z.literal(true),
  })
  .strict()
  .refine((checkpoint) => checkpoint.checkpointedAt >= checkpoint.interruptedAt)
