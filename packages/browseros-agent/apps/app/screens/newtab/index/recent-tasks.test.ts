import { describe, expect, it } from 'bun:test'
import type { ExecutionRecoveryMarker } from '@/lib/execution-history/recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'
import { buildRecentTasks } from './recent-tasks'

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
  })
})
