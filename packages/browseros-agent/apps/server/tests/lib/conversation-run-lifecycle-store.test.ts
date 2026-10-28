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
