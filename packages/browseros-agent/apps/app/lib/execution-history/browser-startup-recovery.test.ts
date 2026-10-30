import { describe, expect, it } from 'bun:test'
import {
  createBrowserStartupRecoveryMarkers,
  persistBrowserStartupRecoveryMarkers,
} from './browser-startup-recovery'
import {
  browserStartupRecoveryMarkerKey,
  executionRecoveryMarkerKey,
  getExecutionRecoveryMarker,
} from './recovery'
import type { ExecutionHistoryByConversation } from './types'

const oldRunningTask = {
  id: 'old-running',
  conversationId: 'conversation-1',
  promptText: 'local fixture',
  startedAt: '2026-10-29T12:00:00.000Z',
  status: 'running' as const,
  actionCount: 0,
  approvalCount: 0,
  deniedCount: 0,
  errorCount: 0,
  steps: [],
}

const history: ExecutionHistoryByConversation = {
  one: {
    conversationId: 'conversation-1',
    updatedAt: 1,
    tasks: [
      oldRunningTask,
      {
        ...oldRunningTask,
        id: 'new-running',
        startedAt: '2026-10-30T12:00:00.001Z',
      },
      { ...oldRunningTask, id: 'completed', status: 'completed' },
    ],
  },
}

function fakeStorage(initialHistory: unknown) {
  const values: Record<string, unknown> = {
    executionHistoryByConversation: initialHistory,
  }
  const writes: Record<string, unknown>[] = []
  return {
    values,
    writes,
    storage: {
      get: async (keys: string | string[]) => {
        const requested = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(
          requested.flatMap((key) =>
            Object.hasOwn(values, key) ? [[key, values[key]]] : [],
          ),
        )
      },
      set: async (items: Record<string, unknown>) => {
        writes.push(items)
        Object.assign(values, items)
      },
    },
  }
}

describe('browser startup task recovery', () => {
  const startupAt = '2026-10-30T12:00:00.000Z'

  it('marks only tasks that were running before browser startup', () => {
    expect(createBrowserStartupRecoveryMarkers(history, startupAt)).toEqual([
      {
        taskId: 'old-running',
        conversationId: 'conversation-1',
        status: 'interrupted',
        completedAt: startupAt,
        source: 'browser-startup',
      },
    ])
  })

  it('skips malformed stored conversations and tasks without blocking valid recovery', async () => {
    const malformedHistory = {
      valid: history.one,
      missingTasks: { conversationId: 'broken' },
      nonArrayTasks: { conversationId: 'broken-again', tasks: null },
      malformedTasks: {
        conversationId: 'also-broken',
        tasks: [null, { id: 'no-start-time', status: 'running' }],
      },
    } as unknown as ExecutionHistoryByConversation

    expect(
      createBrowserStartupRecoveryMarkers(malformedHistory, startupAt),
    ).toHaveLength(1)

    const store = fakeStorage(malformedHistory)
    await expect(
      persistBrowserStartupRecoveryMarkers(store.storage, startupAt),
    ).resolves.toBeUndefined()
    expect(Object.keys(store.writes[0] ?? {})).toEqual([
      browserStartupRecoveryMarkerKey('old-running'),
    ])
  })

  it('persists per-task markers without rewriting task history or replaying work', async () => {
    const store = fakeStorage(history)
    await persistBrowserStartupRecoveryMarkers(store.storage, startupAt)

    expect(store.writes).toEqual([
      {
        'executionHistoryBrowserStartup:old-running': {
          taskId: 'old-running',
          conversationId: 'conversation-1',
          status: 'interrupted',
          completedAt: startupAt,
          source: 'browser-startup',
        },
      },
    ])
    expect(store.values.executionHistoryByConversation).toBe(history)
  })

  it('does not mark a task that became terminal before marker persistence', async () => {
    const terminalHistory: ExecutionHistoryByConversation = {
      one: {
        ...history.one,
        tasks: [{ ...oldRunningTask, status: 'completed' }],
      },
    }
    const store = fakeStorage(history)
    let reads = 0
    const changingStorage = {
      ...store.storage,
      get: async (keys: string | string[]) => {
        reads += 1
        if (reads === 1) return { executionHistoryByConversation: history }
        if (reads === 2)
          return { executionHistoryByConversation: terminalHistory }
        return store.storage.get(keys)
      },
    }
    await persistBrowserStartupRecoveryMarkers(changingStorage, startupAt)

    expect(store.writes).toEqual([])
  })

  it('does not overwrite a server marker written concurrently', async () => {
    const store = fakeStorage(history)
    const serverMarker = {
      taskId: 'old-running',
      conversationId: 'conversation-1',
      status: 'completed' as const,
      completedAt: '2026-10-30T11:59:00.000Z',
    }
    let reads = 0
    const racingStorage = {
      ...store.storage,
      get: async (keys: string | string[]) => {
        reads += 1
        if (reads === 3) {
          store.values[executionRecoveryMarkerKey('old-running')] = serverMarker
        }
        return store.storage.get(keys)
      },
    }
    await persistBrowserStartupRecoveryMarkers(racingStorage, startupAt)

    expect(store.writes).toHaveLength(1)
    expect(store.values[executionRecoveryMarkerKey('old-running')]).toBe(
      serverMarker,
    )
    expect(
      getExecutionRecoveryMarker('old-running', 'conversation-1', store.values),
    ).toBe(serverMarker)
    expect(
      store.values[browserStartupRecoveryMarkerKey('old-running')],
    ).toMatchObject({ status: 'interrupted', source: 'browser-startup' })
  })
})
