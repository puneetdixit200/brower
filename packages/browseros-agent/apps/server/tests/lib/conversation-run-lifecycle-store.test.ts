/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DbConversationRunLifecycleStore } from '../../src/lib/conversations/conversation-run-lifecycle-store'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'

describe('conversation run lifecycle trace persistence', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    closeDb()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('validates and scopes persisted events by conversation and run', () => {
    const store = createStore()
    const first = traceEvent(RUN_A, 1)
    const second = traceEvent(RUN_B, 2)
    store.appendTraceEvent('conversation-a', RUN_A, first)
    store.appendTraceEvent('conversation-a', RUN_B, second)
    store.appendTraceEvent('conversation-b', RUN_A, traceEvent(RUN_A, 3))

    expect(store.getTraceEvents('conversation-a', RUN_A)).toEqual([first])
    expect(store.getTraceEvents('conversation-a', RUN_B)).toEqual([second])
    expect(() =>
      store.appendTraceEvent('conversation-a', RUN_A, {
        ...first,
        toolName: 'secret-token-value',
      }),
    ).toThrow()
  })

  it('persists one stable interruption event for a recovered run', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    store.finish('conversation-a', RUN_A, 'interrupted', 200)

    const first = store.ensureInterruptionTraceEvent(
      'conversation-a',
      RUN_A,
      200,
    )
    const repeated = store.ensureInterruptionTraceEvent(
      'conversation-a',
      RUN_A,
      300,
    )

    expect(first.kind).toBe('task_interrupted')
    expect(repeated).toEqual(first)
    expect(store.getTraceEvents('conversation-a', RUN_A)).toEqual([first])
  })

  it('stores only opted-in text, caps UTF-8 bytes, scopes it to the run, and recovers it after reopen', () => {
    const store = createStore()
    store.start('opted-out', RUN_A, 100)
    store.appendPartialAssistantText('opted-out', RUN_A, 'private')
    expect(store.getPartialAssistantText('opted-out', RUN_A)).toBeUndefined()

    store.start('conversation-a', RUN_A, 110, true)
    store.appendPartialAssistantText(
      'conversation-a',
      RUN_A,
      'a'.repeat(16_383),
    )
    store.appendPartialAssistantText('conversation-a', RUN_A, '🙂ignored')
    expect(
      Buffer.byteLength(
        store.getPartialAssistantText('conversation-a', RUN_A) ?? '',
        'utf8',
      ),
    ).toBe(16_383)
    expect(
      store.getPartialAssistantText('conversation-a', RUN_B),
    ).toBeUndefined()

    const dbPath = getDbHandle().path
    closeDb()
    initializeDb({ dbPath })
    const recovered = new DbConversationRunLifecycleStore()
    expect(recovered.get('conversation-a')?.status).toBe('interrupted')
    expect(recovered.getPartialAssistantText('conversation-a', RUN_A)).toBe(
      'a'.repeat(16_383),
    )
    expect(
      recovered.getPartialAssistantText('conversation-a', RUN_B),
    ).toBeUndefined()
  })

  it('clears checkpoints on completed and replacement runs and leaves canonical conversation messages unchanged', async () => {
    const store = createStore()
    const { DbConversationStore } = await import(
      '../../src/lib/conversations/conversation-store'
    )
    const conversations = new DbConversationStore()
    const canonicalMessages = [
      {
        id: 'user-1',
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'canonical' }],
      },
    ]
    await conversations.save({
      id: 'conversation-a',
      messages: canonicalMessages,
      targetType: 'browseros',
    })

    store.start('conversation-a', RUN_A, 100, true)
    store.appendPartialAssistantText('conversation-a', RUN_A, 'display only')
    expect((await conversations.get('conversation-a'))?.messages).toEqual(
      canonicalMessages,
    )
    store.finish('conversation-a', RUN_A, 'completed', 120)
    expect(
      store.getPartialAssistantText('conversation-a', RUN_A),
    ).toBeUndefined()

    store.start('conversation-a', RUN_B, 130, true)
    expect(
      store.getPartialAssistantText('conversation-a', RUN_A),
    ).toBeUndefined()
    expect((await conversations.get('conversation-a'))?.messages).toEqual(
      canonicalMessages,
    )
  })

  it('persists trace degradation per run and resets it when a replacement run starts', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    expect(store.get('conversation-a')?.tracePersistenceDegraded).toBe(false)

    store.markTracePersistenceDegraded('conversation-a', RUN_A)
    expect(store.get('conversation-a')?.tracePersistenceDegraded).toBe(true)

    store.start('conversation-a', RUN_B, 200)
    expect(store.get('conversation-a')).toMatchObject({
      runId: RUN_B,
      status: 'running',
      tracePersistenceDegraded: false,
    })
  })

  it('rejects corrupt persisted payloads when reading', () => {
    const store = createStore()
    const event = traceEvent(RUN_A, 1)
    store.appendTraceEvent('conversation-a', RUN_A, event)
    getDbHandle()
      .sqlite.prepare(
        'UPDATE conversation_run_trace_events SET event_json = ? WHERE event_id = ?',
      )
      .run('{invalid', event.eventId)

    expect(() => store.getTraceEvents('conversation-a', RUN_A)).toThrow(
      'Stored conversation run trace event is invalid JSON',
    )
  })

  it('keeps trace retention bounded and removes all events on conversation deletion', () => {
    const store = createStore()
    for (let index = 0; index < 501; index += 1) {
      store.appendTraceEvent('conversation-a', RUN_A, traceEvent(RUN_A, index))
    }

    const retained = store.getTraceEvents('conversation-a', RUN_A)
    expect(retained).toHaveLength(500)
    expect(retained[0]?.at).toBe(1)
    expect(store.delete('conversation-a')).toBe(true)
    expect(store.getTraceEvents('conversation-a', RUN_A)).toEqual([])
    expect(store.delete('conversation-a')).toBe(false)
  })

  it('completes a human wait once for the exact active run and request', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    const wait = store.beginHumanWait('conversation-a', RUN_A, 'request-a', 110)
    expect(wait).toMatchObject({ phase: 'waiting', version: 1 })
    store.beginHumanWait('conversation-a', RUN_A, 'replacement-request', 115)

    expect(
      store.completeHumanWait('conversation-a', RUN_A, 'request-a', 120),
    ).toBe(false)
    expect(
      store.completeHumanWait('conversation-a', RUN_B, 'request-a', 120),
    ).toBe(false)
    expect(
      store.completeHumanWait(
        'conversation-a',
        RUN_A,
        'replacement-request',
        120,
      ),
    ).toBe(true)
    expect(
      store.completeHumanWait(
        'conversation-a',
        RUN_A,
        'replacement-request',
        130,
      ),
    ).toBe(false)
    expect(store.getHumanWait('conversation-a', RUN_A)).toMatchObject({
      requestId: 'replacement-request',
      phase: 'human_completed',
      createdAt: 115,
      updatedAt: 120,
      completedAt: 120,
      version: 3,
    })
  })

  it('invalidates an active wait when its run stops', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    store.beginHumanWait('conversation-a', RUN_A, 'stop-request', 110)

    store.finish('conversation-a', RUN_A, 'aborted', 120)

    expect(store.getCurrentHumanWait('conversation-a')).toBeUndefined()
    expect(
      store.completeHumanWait('conversation-a', RUN_A, 'stop-request', 130),
    ).toBe(false)
    expect(
      store.authorizeFreshConversation(
        'conversation-a',
        RUN_A,
        'stop-request',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).toBeUndefined()
  })

  it('marks a prior pending wait interrupted when a replacement run starts', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    store.beginHumanWait('conversation-a', RUN_A, 'prior-request', 110)

    store.start('conversation-a', RUN_B, 200)
    store.beginHumanWait('conversation-a', RUN_B, 'replacement-request', 210)

    expect(store.getHumanWait('conversation-a', RUN_A)).toMatchObject({
      requestId: 'prior-request',
      phase: 'interrupted',
    })
    expect(store.getCurrentHumanWait('conversation-a')).toMatchObject({
      runId: RUN_B,
      requestId: 'replacement-request',
      phase: 'waiting',
    })
  })

  it('recovers an interrupted wait after closing and reopening the database', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    store.beginHumanWait('conversation-a', RUN_A, 'opaque-request', 110)
    const dbPath = getDbHandle().path
    closeDb()
    initializeDb({ dbPath })
    const recovered = new DbConversationRunLifecycleStore()

    expect(recovered.get('conversation-a')).toMatchObject({
      runId: RUN_A,
      status: 'interrupted',
    })
    expect(recovered.getHumanWait('conversation-a', RUN_A)).toMatchObject({
      conversationId: 'conversation-a',
      runId: RUN_A,
      requestId: 'opaque-request',
      phase: 'interrupted',
      createdAt: 110,
      completedAt: null,
      version: 2,
    })

    const firstFreshConversationId = '33333333-3333-4333-8333-333333333333'
    const retryFreshConversationId = '44444444-4444-4444-8444-444444444444'
    expect(
      recovered.authorizeFreshConversation(
        'conversation-a',
        RUN_A,
        'opaque-request',
        firstFreshConversationId,
      ),
    ).toBe(firstFreshConversationId)
    expect(
      recovered.authorizeFreshConversation(
        'conversation-a',
        RUN_A,
        'opaque-request',
        retryFreshConversationId,
      ),
    ).toBe(firstFreshConversationId)
    expect(recovered.getHumanWait('conversation-a', RUN_A)).toMatchObject({
      requestId: 'opaque-request',
      phase: 'interrupted',
      version: 3,
    })

    // The lifecycle schema and decoded records contain only metadata; no execution payload is persisted.
    expect(
      Object.keys(recovered.getHumanWait('conversation-a', RUN_A) ?? {}),
    ).toEqual([
      'conversationId',
      'runId',
      'requestId',
      'phase',
      'createdAt',
      'updatedAt',
      'completedAt',
      'version',
    ])
    expect(Object.keys(recovered.get('conversation-a') ?? {})).toEqual([
      'conversationId',
      'runId',
      'status',
      'startedAt',
      'finishedAt',
      'tracePersistenceDegraded',
    ])

    const columns = getDbHandle()
      .sqlite.query<{ name: string }, []>(
        'PRAGMA table_info(conversation_human_waits)',
      )
      .all()
      .map((column) => column.name)
    expect(columns).toEqual([
      'conversation_id',
      'run_id',
      'request_id',
      'phase',
      'created_at',
      'updated_at',
      'completed_at',
      'version',
      'fresh_conversation_id',
    ])
  })

  it('exposes the current wait and consumes fresh conversation authorization once', () => {
    const store = createStore()
    store.start('conversation-a', RUN_A, 100)
    store.beginHumanWait('conversation-a', RUN_A, 'opaque-request', 110)
    expect(store.getCurrentHumanWait('conversation-a')).toMatchObject({
      runId: RUN_A,
      requestId: 'opaque-request',
      phase: 'waiting',
    })
    store.finish('conversation-a', RUN_A, 'interrupted', 120)
    expect(store.getCurrentHumanWait('conversation-a')).toMatchObject({
      runId: RUN_A,
      requestId: 'opaque-request',
      phase: 'interrupted',
    })

    const freshConversationId = '33333333-3333-4333-8333-333333333333'
    expect(
      store.authorizeFreshConversation(
        'conversation-a',
        RUN_B,
        'opaque-request',
        freshConversationId,
      ),
    ).toBeUndefined()
    expect(
      store.authorizeFreshConversation(
        'conversation-a',
        RUN_A,
        'stale-request',
        freshConversationId,
      ),
    ).toBeUndefined()
    expect(
      store.authorizeFreshConversation(
        'conversation-a',
        RUN_A,
        'opaque-request',
        freshConversationId,
      ),
    ).toBe(freshConversationId)
    expect(
      store.authorizeFreshConversation(
        'conversation-a',
        RUN_A,
        'opaque-request',
        '44444444-4444-4444-8444-444444444444',
      ),
    ).toBe(freshConversationId)
    expect(store.getCurrentHumanWait('conversation-a')).toMatchObject({
      runId: RUN_A,
      phase: 'interrupted',
    })
  })

  function createStore(): DbConversationRunLifecycleStore {
    tempDir = mkdtempSync(join(tmpdir(), 'conversation-trace-store-'))
    initializeDb({ dbPath: join(tempDir, 'browseros.sqlite') })
    return new DbConversationRunLifecycleStore()
  }
})

const RUN_A = '11111111-1111-4111-8111-111111111111'
const RUN_B = '22222222-2222-4222-8222-222222222222'

function traceEvent(runId: string, index: number) {
  const eventId = `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
  return {
    version: 1 as const,
    taskId: runId,
    eventId,
    at: index,
    kind: 'task_interrupted' as const,
  }
}
