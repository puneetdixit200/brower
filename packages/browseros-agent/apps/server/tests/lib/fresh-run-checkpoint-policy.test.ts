/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  authorizeFreshConversationCheckpoint,
  createFreshRunCheckpoint,
} from '../../src/lib/conversations/fresh-run-checkpoint-policy'

const interrupted = {
  conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  runId: 'run-old',
  runStatus: 'interrupted',
  waitId: 'wait-opaque',
  waitPhase: 'interrupted',
  runStartedAt: 100,
  runFinishedAt: 300,
  waitCreatedAt: 200,
  waitUpdatedAt: 300,
}

describe('fresh run checkpoint policy', () => {
  it('creates a content-free checkpoint and requires a later explicit confirmation', () => {
    const result = createFreshRunCheckpoint(interrupted, 310)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.checkpoint).toEqual({
      kind: 'fresh_run_checkpoint',
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      interruptedRunId: 'run-old',
      waitId: 'wait-opaque',
      interruptedAt: 300,
      checkpointedAt: 310,
      requiresExplicitConfirmation: true,
    })

    const confirmed = authorizeFreshConversationCheckpoint(
      result.checkpoint,
      {
        sourceConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        interruptedRunId: 'run-old',
        waitId: 'wait-opaque',
        confirmedAt: 311,
        freshConversationId: '00000000-0000-4000-8000-000000000001',
      },
      false,
    )
    expect(confirmed).toEqual({
      ok: true,
      authorization: {
        kind: 'fresh_conversation_authorized',
        sourceConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        interruptedRunId: 'run-old',
        waitId: 'wait-opaque',
        freshConversationId: '00000000-0000-4000-8000-000000000001',
        confirmedAt: 311,
        carriesPriorExecutionState: false,
      },
    })
  })

  it('rejects non-interrupted, stale, malformed, and payload-bearing snapshots', () => {
    expect(
      createFreshRunCheckpoint({ ...interrupted, runStatus: 'running' }, 310),
    ).toEqual({ ok: false, reason: 'invalid_or_stale_interruption' })
    expect(
      createFreshRunCheckpoint({ ...interrupted, waitPhase: 'waiting' }, 310),
    ).toEqual({ ok: false, reason: 'invalid_or_stale_interruption' })
    expect(
      createFreshRunCheckpoint({ ...interrupted, waitUpdatedAt: 301 }, 310),
    ).toEqual({ ok: false, reason: 'invalid_or_stale_interruption' })
    expect(
      createFreshRunCheckpoint(
        { ...interrupted, waitUpdatedAt: Number.MAX_SAFE_INTEGER + 1 },
        310,
      ),
    ).toEqual({ ok: false, reason: 'invalid_or_stale_interruption' })
    expect(
      createFreshRunCheckpoint(interrupted, Number.MAX_SAFE_INTEGER + 1),
    ).toEqual({ ok: false, reason: 'invalid_or_stale_interruption' })
    expect(
      createFreshRunCheckpoint({ ...interrupted, transcript: ['secret'] }, 310),
    ).toEqual({ ok: false, reason: 'invalid_or_stale_interruption' })
  })

  it('rejects mismatched identity, duplicate use, early confirmation, and reuse of the source conversation id', () => {
    const checkpoint = createFreshRunCheckpoint(interrupted, 310)
    if (!checkpoint.ok) throw new Error('Expected valid checkpoint')
    const base = {
      sourceConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      interruptedRunId: 'run-old',
      waitId: 'wait-opaque',
      confirmedAt: 311,
      freshConversationId: '00000000-0000-4000-8000-000000000001',
    }

    expect(
      authorizeFreshConversationCheckpoint(
        checkpoint.checkpoint,
        { ...base, waitId: 'another-wait' },
        false,
      ),
    ).toEqual({ ok: false, reason: 'identity_mismatch' })
    expect(
      authorizeFreshConversationCheckpoint(checkpoint.checkpoint, base, true),
    ).toEqual({ ok: false, reason: 'duplicate_confirmation' })
    expect(
      authorizeFreshConversationCheckpoint(
        checkpoint.checkpoint,
        { ...base, confirmedAt: 309 },
        false,
      ),
    ).toEqual({ ok: false, reason: 'confirmation_before_checkpoint' })
    expect(
      authorizeFreshConversationCheckpoint(
        checkpoint.checkpoint,
        {
          ...base,
          freshConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        false,
      ),
    ).toEqual({
      ok: false,
      reason: 'fresh_conversation_reuses_source_conversation',
    })
  })

  it('does not accept prior execution state in the checkpoint or authorization request', () => {
    const checkpoint = createFreshRunCheckpoint(interrupted, 310)
    if (!checkpoint.ok) throw new Error('Expected valid checkpoint')
    expect(
      authorizeFreshConversationCheckpoint(
        { ...checkpoint.checkpoint, providerPayload: { token: 'secret' } },
        {
          sourceConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          interruptedRunId: 'run-old',
          waitId: 'wait-opaque',
          confirmedAt: 311,
          freshConversationId: '00000000-0000-4000-8000-000000000001',
          approvals: ['approved-tool-call'],
        },
        false,
      ),
    ).toEqual({ ok: false, reason: 'invalid_confirmation' })
  })

  it('rejects a forged checkpoint timestamped before the interruption', () => {
    const checkpoint = createFreshRunCheckpoint(interrupted, 310)
    if (!checkpoint.ok) throw new Error('Expected valid checkpoint')

    expect(
      authorizeFreshConversationCheckpoint(
        { ...checkpoint.checkpoint, checkpointedAt: 299 },
        {
          sourceConversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          interruptedRunId: 'run-old',
          waitId: 'wait-opaque',
          confirmedAt: 311,
          freshConversationId: '00000000-0000-4000-8000-000000000001',
        },
        false,
      ),
    ).toEqual({ ok: false, reason: 'invalid_confirmation' })
  })
})
