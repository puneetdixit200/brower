import { describe, expect, it } from 'bun:test'
import type { ExecutionRecoveryMarker } from '@/lib/execution-history/recovery'
import {
  browserStartupRecoveryMarkerKey,
  executionRecoveryMarkerKey,
} from '@/lib/execution-history/recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'
import { buildRecentTasks, loadRecentTasks } from './recent-tasks'

function task(
  id: string,
  conversationId: string,
  startedAt: string,
  overrides: Partial<ExecutionTaskRecord> = {},
): ExecutionTaskRecord {
  return {
    id,
    conversationId,
    promptText: `Task ${id}`,
    startedAt,
    status: 'running',
    actionCount: 0,
    approvalCount: 0,
    deniedCount: 0,
    errorCount: 0,
    steps: [],
    ...overrides,
  }
}

function marker(
  taskId: string,
  conversationId: string,
): ExecutionRecoveryMarker {
  return {
    taskId,
    conversationId,
    status: 'interrupted',
    completedAt: '2026-10-28T12:00:00.000Z',
  }
}

function history(
  conversationId: string,
  tasks: ExecutionTaskRecord[],
): ExecutionHistoryByConversation {
  return {
    [conversationId]: {
      conversationId,
      updatedAt: 1,
      tasks,
    },
  }
}

describe('buildRecentTasks', () => {
  it('applies only markers matching the task, conversation, and running state', () => {
    const records: ExecutionHistoryByConversation = {
      primary: {
        conversationId: 'conversation-primary',
        updatedAt: 1,
        tasks: [
          task('running-match', 'conversation-primary', '2026-10-28T10:00:00Z'),
          task(
            'running-wrong-conversation',
            'conversation-primary',
            '2026-10-28T09:00:00Z',
          ),
          task(
            'already-complete',
            'conversation-primary',
            '2026-10-28T08:00:00Z',
            {
              status: 'completed',
            },
          ),
        ],
      },
      duplicate: {
        conversationId: 'conversation-duplicate',
        updatedAt: 1,
        tasks: [
          task(
            'running-match',
            'conversation-duplicate',
            '2026-10-28T07:00:00Z',
          ),
        ],
      },
    }
    const recent = buildRecentTasks(records, [
      marker('running-match', 'conversation-primary'),
      marker('running-wrong-conversation', 'another-conversation'),
      marker('already-complete', 'conversation-primary'),
      marker('no-longer-present', 'conversation-primary'),
    ])

    expect(
      recent.map(({ id, conversationId, status }) => [
        id,
        conversationId,
        status,
      ]),
    ).toEqual([
      ['running-match', 'conversation-primary', 'interrupted'],
      ['running-wrong-conversation', 'conversation-primary', 'running'],
      ['already-complete', 'conversation-primary', 'completed'],
    ])

    const duplicateTask = buildRecentTasks({ duplicate: records.duplicate }, [
      marker('running-match', 'conversation-primary'),
    ])
    expect(duplicateTask[0]).toMatchObject({
      id: 'running-match',
      conversationId: 'conversation-duplicate',
      status: 'running',
    })
  })

  it('filters credential-shaped records, sorts newest first, and caps at three', () => {
    const recent = buildRecentTasks(
      history('conversation', [
        task('oldest-safe', 'conversation', '2026-10-28T01:00:00Z'),
        task('middle-safe', 'conversation', '2026-10-28T02:00:00Z'),
        task('secret-prompt', 'conversation', '2026-10-28T03:00:00Z', {
          promptText: 'Use API key: fixture-not-real',
        }),
        task('secret-response', 'conversation', '2026-10-28T03:30:00Z', {
          responseText: 'Bearer abcdefghijklmnopqrstuvwxyz',
        }),
        task('path-prompt', 'conversation', '2026-10-28T03:45:00Z', {
          promptText: 'Open (/workspace/private/notes.txt)',
        }),
        task('newer-safe', 'conversation', '2026-10-28T04:00:00Z'),
        task('newest-safe', 'conversation', '2026-10-28T05:00:00Z'),
      ]),
      [],
    )

    expect(recent.map(({ id }) => id)).toEqual([
      'newest-safe',
      'newer-safe',
      'middle-safe',
    ])
    expect(recent.some(({ id }) => id === 'secret-prompt')).toBe(false)
    expect(recent.some(({ id }) => id === 'secret-response')).toBe(false)
    expect(recent.some(({ id }) => id === 'path-prompt')).toBe(false)
  })

  it('preserves matching recovery marker behavior after filtering unsafe cards', () => {
    const recent = buildRecentTasks(
      history('conversation', [
        task('unsafe-running', 'conversation', '2026-10-28T02:00:00Z', {
          promptText: 'Use password: fixture-secret',
        }),
        task('safe-running', 'conversation', '2026-10-28T01:00:00Z'),
      ]),
      [
        marker('unsafe-running', 'conversation'),
        marker('safe-running', 'conversation'),
      ],
    )

    expect(recent.map(({ id, status }) => [id, status])).toEqual([
      ['safe-running', 'interrupted'],
    ])
  })
})

describe('loadRecentTasks', () => {
  it('projects a startup interrupted marker from persisted storage', async () => {
    const persisted = history('conversation', [
      task('startup-task', 'conversation', '2026-10-28T10:00:00Z'),
    ])
    const storage = {
      get: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys]
        if (list[0] === 'executionHistoryByConversation') {
          return { executionHistoryByConversation: persisted }
        }
        return {
          [browserStartupRecoveryMarkerKey('startup-task')]: {
            ...marker('startup-task', 'conversation'),
            source: 'browser-startup' as const,
          },
        }
      },
    }
    await expect(loadRecentTasks(storage)).resolves.toMatchObject([
      { id: 'startup-task', status: 'interrupted' },
    ])
  })

  it('prefers a matching server terminal marker over startup interruption', async () => {
    const persisted = history('conversation', [
      task('server-task', 'conversation', '2026-10-28T10:00:00Z'),
    ])
    const storage = {
      get: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys]
        if (list[0] === 'executionHistoryByConversation') {
          return { executionHistoryByConversation: persisted }
        }
        return {
          [browserStartupRecoveryMarkerKey('server-task')]: {
            ...marker('server-task', 'conversation'),
            source: 'browser-startup' as const,
          },
          [executionRecoveryMarkerKey('server-task')]: {
            ...marker('server-task', 'conversation'),
            status: 'completed' as const,
          },
        }
      },
    }
    await expect(loadRecentTasks(storage)).resolves.toMatchObject([
      { id: 'server-task', status: 'completed' },
    ])
  })

  it('checks duplicate task IDs against their own conversations and leaves unmarked rows running', async () => {
    const persisted = history('conversation-one', [
      task('shared-id', 'conversation-one', '2026-10-28T10:00:00Z'),
    ])
    persisted.other = {
      conversationId: 'conversation-two',
      updatedAt: 1,
      tasks: [task('shared-id', 'conversation-two', '2026-10-28T09:00:00Z')],
    }
    const storage = {
      get: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys]
        if (list[0] === 'executionHistoryByConversation') {
          return { executionHistoryByConversation: persisted }
        }
        return {
          [executionRecoveryMarkerKey('shared-id')]: marker(
            'shared-id',
            'conversation-one',
          ),
        }
      },
    }
    await expect(loadRecentTasks(storage)).resolves.toMatchObject([
      {
        id: 'shared-id',
        conversationId: 'conversation-one',
        status: 'interrupted',
      },
      {
        id: 'shared-id',
        conversationId: 'conversation-two',
        status: 'running',
      },
    ])
  })

  it('returns empty for missing or malformed history and leaves unmarked tasks running', async () => {
    await expect(loadRecentTasks({ get: async () => ({}) })).resolves.toEqual(
      [],
    )
    await expect(
      loadRecentTasks({
        get: async () => ({
          executionHistoryByConversation: { broken: { tasks: [null] } },
        }),
      }),
    ).resolves.toEqual([])
    await expect(
      loadRecentTasks({
        get: async () => ({
          executionHistoryByConversation: history('conversation', [
            task('plain', 'conversation', '2026-10-28T10:00:00Z'),
          ]),
        }),
      }),
    ).resolves.toMatchObject([{ id: 'plain', status: 'running' }])
  })

  it('fails closed for unknown task statuses and malformed nested records', async () => {
    const stored = (record: unknown) =>
      loadRecentTasks({
        get: async () => ({ executionHistoryByConversation: record }),
      })
    const unknownStatus = history('conversation', [
      task('invalid-status', 'conversation', '2026-10-28T10:00:00Z', {
        status: 'queued' as ExecutionTaskRecord['status'],
      }),
    ])
    const nullStep = history('conversation', [
      task('invalid-step', 'conversation', '2026-10-28T10:00:00Z'),
    ])
    ;(nullStep.conversation.tasks[0] as { steps: unknown[] }).steps = [null]
    const nullArtifact = history('conversation', [
      task('invalid-artifact', 'conversation', '2026-10-28T10:00:00Z'),
    ])
    ;(
      nullArtifact.conversation.tasks[0] as { artifacts: unknown[] }
    ).artifacts = [null]
    const unknownStepState = history('conversation', [
      task('invalid-step-state', 'conversation', '2026-10-28T10:00:00Z'),
    ])
    ;(unknownStepState.conversation.tasks[0] as { steps: unknown[] }).steps = [
      {
        id: 'step',
        toolName: 'tool',
        order: 0,
        state: 'queued',
        startedAt: '2026-10-28T10:00:00Z',
        previewText: 'preview',
      },
    ]
    const mismatchedConversation = history('conversation', [
      task('wrong-owner', 'another-conversation', '2026-10-28T10:00:00Z'),
    ])
    const malformedResponse = history('conversation', [
      task('invalid-response', 'conversation', '2026-10-28T10:00:00Z', {
        responseText: 42 as unknown as string,
      }),
    ])
    const malformedCounter = history('conversation', [
      task('invalid-counter', 'conversation', '2026-10-28T10:00:00Z', {
        actionCount: 'one' as unknown as number,
      }),
    ])

    await expect(stored(unknownStatus)).resolves.toEqual([])
    await expect(stored(nullStep)).resolves.toEqual([])
    await expect(stored(nullArtifact)).resolves.toEqual([])
    await expect(stored(unknownStepState)).resolves.toEqual([])
    await expect(stored(mismatchedConversation)).resolves.toEqual([])
    await expect(stored(malformedResponse)).resolves.toEqual([])
    await expect(stored(malformedCounter)).resolves.toEqual([])
  })

  it('rejects storage errors so the component can show its error state', async () => {
    const failure = new Error('storage unavailable')
    await expect(
      loadRecentTasks({
        get: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
  })
})
