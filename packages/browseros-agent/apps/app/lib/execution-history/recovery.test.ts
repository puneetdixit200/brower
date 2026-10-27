import { describe, expect, it, mock } from 'bun:test'
import type { ExecutionRecoveryMarker } from './recovery'
import {
  applyExecutionRecoveryMarkers,
  executionRecoveryMarkerKey,
  isExecutionRecoveryMarker,
  reconcileInterruptedExecutionTasks,
} from './recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from './types'

const task = (
  id: string,
  status: ExecutionTaskRecord['status'],
): ExecutionTaskRecord => ({
  id,
  conversationId: 'conversation/one',
  promptText: 'local fixture',
  startedAt: '2026-10-27T00:00:00.000Z',
  status,
  actionCount: 0,
  approvalCount: 0,
  deniedCount: 0,
  errorCount: 0,
  steps: [],
})

const history: ExecutionHistoryByConversation = {
  first: {
    conversationId: 'conversation/one',
    updatedAt: 1,
    tasks: [task('running-1', 'running'), task('done', 'completed')],
  },
  second: {
    conversationId: 'conversation/one',
    updatedAt: 1,
    tasks: [task('running-2', 'running'), task('failed', 'failed')],
  },
}

function response(status: number): Response {
  return new Response(null, { status })
}

describe('interrupted execution recovery', () => {
  it('creates per-task markers only for running tasks when the server returns 404', async () => {
    const fetchImpl = mock(async (_input: RequestInfo | URL) => response(404))
    const markers = await reconcileInterruptedExecutionTasks(history, {
      serverUrl: 'http://127.0.0.1:9000',
      fetchImpl,
      now: () => '2026-10-27T01:00:00.000Z',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:9000/chat/conversation%2Fone/state',
    )
    expect(markers).toEqual([
      {
        taskId: 'running-1',
        conversationId: 'conversation/one',
        status: 'interrupted',
        completedAt: '2026-10-27T01:00:00.000Z',
      },
      {
        taskId: 'running-2',
        conversationId: 'conversation/one',
        status: 'interrupted',
        completedAt: '2026-10-27T01:00:00.000Z',
      },
    ])
    expect(executionRecoveryMarkerKey('running-1')).toBe(
      'executionHistoryRecovery:running-1',
    )
  })

  it.each([200, 500, 503])(
    'does not create markers for HTTP %s',
    async (status) => {
      const markers = await reconcileInterruptedExecutionTasks(history, {
        serverUrl: 'http://127.0.0.1:9000',
        fetchImpl: async () => response(status),
      })
      expect(markers).toEqual([])
    },
  )

  it('does not create markers when the state request fails', async () => {
    const markers = await reconcileInterruptedExecutionTasks(history, {
      serverUrl: 'http://127.0.0.1:9000',
      fetchImpl: async () => {
        throw new Error('offline')
      },
    })
    expect(markers).toEqual([])
  })

  it('overlays markers idempotently and only on matching running tasks', () => {
    const markers: ExecutionRecoveryMarker[] = [
      {
        taskId: 'running-1',
        conversationId: 'conversation/one',
        status: 'interrupted',
        completedAt: '2026-10-27T01:00:00.000Z',
      },
    ]
    const recovered = applyExecutionRecoveryMarkers(history, markers)
    expect(recovered.first.tasks[0]?.status).toBe('interrupted')
    expect(recovered.first.tasks[0]?.completedAt).toBe(
      '2026-10-27T01:00:00.000Z',
    )
    expect(recovered.first.tasks[1]?.status).toBe('completed')
    expect(applyExecutionRecoveryMarkers(recovered, markers)).toBe(recovered)
  })

  it('lets terminal updates and deletions win over a saved marker', () => {
    const marker: ExecutionRecoveryMarker[] = [
      {
        taskId: 'running-1',
        conversationId: 'conversation/one',
        status: 'interrupted',
        completedAt: '2026-10-27T01:00:00.000Z',
      },
    ]
    const latest: ExecutionHistoryByConversation = {
      first: {
        conversationId: 'conversation/one',
        updatedAt: 2,
        tasks: [task('running-1', 'completed')],
      },
    }
    expect(applyExecutionRecoveryMarkers(latest, marker)).toBe(latest)

    const deleted: ExecutionHistoryByConversation = {}
    expect(applyExecutionRecoveryMarkers(deleted, marker)).toBe(deleted)
    expect(Object.keys(applyExecutionRecoveryMarkers(deleted, marker))).toEqual(
      [],
    )
  })

  it('does not apply a marker to a different task or conversation', () => {
    const otherTask: ExecutionHistoryByConversation = {
      first: {
        conversationId: 'conversation/one',
        updatedAt: 2,
        tasks: [task('other-task', 'running')],
      },
    }
    const otherConversation: ExecutionHistoryByConversation = {
      first: {
        conversationId: 'conversation/two',
        updatedAt: 2,
        tasks: [
          {
            ...task('running-1', 'running'),
            conversationId: 'conversation/two',
          },
        ],
      },
    }
    const marker: ExecutionRecoveryMarker[] = [
      {
        taskId: 'running-1',
        conversationId: 'conversation/one',
        status: 'interrupted',
        completedAt: '2026-10-27T01:00:00.000Z',
      },
    ]
    expect(applyExecutionRecoveryMarkers(otherTask, marker)).toBe(otherTask)
    expect(applyExecutionRecoveryMarkers(otherConversation, marker)).toBe(
      otherConversation,
    )
  })

  it('validates marker values loaded from extension storage', () => {
    expect(
      isExecutionRecoveryMarker({
        taskId: 'task',
        conversationId: 'conversation',
        status: 'interrupted',
        completedAt: '2026-10-27T01:00:00.000Z',
      }),
    ).toBe(true)
    expect(isExecutionRecoveryMarker({ taskId: 'task' })).toBe(false)
  })
})
