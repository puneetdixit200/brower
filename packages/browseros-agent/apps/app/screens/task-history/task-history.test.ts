import { describe, expect, test } from 'bun:test'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import {
  flattenExecutionHistory,
  getTaskResult,
  getTaskTranscriptResponse,
} from './task-history'

function task(
  id: string,
  startedAt: string,
  overrides: Partial<ExecutionTaskRecord> = {},
): ExecutionTaskRecord {
  return {
    id,
    conversationId: 'conversation-1',
    promptText: `Task ${id}`,
    startedAt,
    completedAt: startedAt,
    status: 'completed',
    responseText: `Result ${id}`,
    actionCount: 0,
    approvalCount: 0,
    deniedCount: 0,
    errorCount: 0,
    steps: [],
    ...overrides,
  }
}

describe('task history helpers', () => {
  test('flattens conversations and sorts tasks newest first', () => {
    const tasks = flattenExecutionHistory({
      old: {
        conversationId: 'old',
        updatedAt: 1,
        tasks: [task('earlier', '2026-10-20T00:00:00.000Z')],
      },
      recent: {
        conversationId: 'recent',
        updatedAt: 2,
        tasks: [task('later', '2026-10-27T00:00:00.000Z')],
      },
    })

    expect(tasks.map((item) => item.id)).toEqual(['later', 'earlier'])
  })

  test('omits tasks with credential-shaped prompts or results', () => {
    const tasks = flattenExecutionHistory({
      history: {
        conversationId: 'history',
        updatedAt: 1,
        tasks: [
          task('safe', '2026-10-27T00:00:00.000Z'),
          task('unsafe-title', '2026-10-26T00:00:00.000Z', {
            promptText: 'Use API key: fixture-not-real',
          }),
          task('unsafe-result', '2026-10-25T00:00:00.000Z', {
            responseText: 'Bearer fixture-token-that-looks-long-enough',
          }),
        ],
      },
    })

    expect(tasks.map((item) => item.id)).toEqual(['safe'])
  })

  test('omits tasks with credential-shaped rendered step text', () => {
    const tasks = flattenExecutionHistory({
      history: {
        conversationId: 'history',
        updatedAt: 1,
        tasks: [
          task('safe', '2026-10-27T00:00:00.000Z'),
          task('unsafe-preview', '2026-10-26T00:00:00.000Z', {
            steps: [
              {
                id: 'step-preview',
                toolName: 'browser.click',
                order: 1,
                state: 'output-available',
                startedAt: '2026-10-26T00:00:00.000Z',
                previewText: 'API key: fixture-not-real',
              },
            ],
          }),
          task('unsafe-tool', '2026-10-25T00:00:00.000Z', {
            steps: [
              {
                id: 'step-tool',
                toolName: 'Bearer fixture-token-that-looks-long-enough',
                order: 1,
                state: 'output-available',
                startedAt: '2026-10-25T00:00:00.000Z',
                previewText: 'Completed safely',
              },
            ],
          }),
        ],
      },
    })

    expect(tasks.map((item) => item.id)).toEqual(['safe'])
  })

  test('uses only the bounded response preview', () => {
    expect(
      getTaskResult(
        task('task', '2026-10-27T00:00:00.000Z', {
          responseText: 'Full response',
          responsePreview: 'Short preview',
        }),
      ),
    ).toBe('Short preview')
  })

  test('uses the saved full response in transcript and falls back to preview', () => {
    const full = task('full', '2026-10-27T00:00:00.000Z', {
      responseText: 'Complete answer',
      responsePreview: 'Short answer',
    })
    const partial = task('partial', '2026-10-27T00:00:00.000Z', {
      responseText: undefined,
      responsePreview: 'Saved partial answer',
    })

    expect(getTaskTranscriptResponse(full)).toBe('Complete answer')
    expect(getTaskTranscriptResponse(partial)).toBe('Saved partial answer')
  })

  test('excludes a run when a displayed approval reason contains credential-shaped text', () => {
    const tasks = flattenExecutionHistory({
      history: {
        conversationId: 'history',
        updatedAt: 1,
        tasks: [
          task('unsafe-approval', '2026-10-27T00:00:00.000Z', {
            steps: [
              {
                id: 'approval',
                toolName: 'browser.click',
                order: 1,
                state: 'approval-responded',
                startedAt: '2026-10-27T00:00:00.000Z',
                previewText: 'Clicked button',
                approval: { id: 'approval', reason: 'password: fixture-value' },
              },
            ],
          }),
        ],
      },
    })

    expect(tasks).toEqual([])
  })

  test('excludes a run when displayed error text matches a known credential pattern', () => {
    const tasks = flattenExecutionHistory({
      history: {
        conversationId: 'history',
        updatedAt: 1,
        tasks: [
          task('unsafe-error', '2026-10-27T00:00:00.000Z', {
            steps: [
              {
                id: 'error',
                toolName: 'browser.click',
                order: 1,
                state: 'output-error',
                startedAt: '2026-10-27T00:00:00.000Z',
                previewText: 'Click failed',
                errorText: 'Bearer abcdefghijklmnopqrstuvwxyz',
              },
            ],
          }),
        ],
      },
    })

    expect(tasks).toEqual([])
  })
})
