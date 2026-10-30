import { describe, expect, test } from 'bun:test'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import {
  flattenExecutionHistory,
  getTaskDisplayRecord,
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

  test('keeps a record but omits credential-shaped prompt and result fields', () => {
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

    expect(tasks.map((item) => item.id)).toEqual([
      'safe',
      'unsafe-title',
      'unsafe-result',
    ])
    expect(tasks[1]?.promptText).toBe('')
    expect(tasks[2]?.responseText).toBeUndefined()
  })

  test('omits credential-bearing timeline fields while retaining safe summaries', () => {
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

    expect(tasks.map((item) => item.id)).toEqual([
      'safe',
      'unsafe-preview',
      'unsafe-tool',
    ])
    expect(tasks[1]?.steps).toEqual([])
    expect(tasks[2]?.steps).toEqual([])
  })

  test('omits unsafe step artifact descriptors while preserving safe timeline steps', () => {
    const tasks = flattenExecutionHistory({
      history: {
        conversationId: 'history',
        updatedAt: 1,
        tasks: [
          task('safe', '2026-10-27T00:00:00.000Z'),
          task('unsafe-step-artifact', '2026-10-26T00:00:00.000Z', {
            steps: [
              {
                id: 'download',
                toolName: 'download',
                order: 1,
                state: 'output-available',
                startedAt: '2026-10-26T00:00:00.000Z',
                previewText: 'Downloaded file',
                artifact: {
                  filename: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
                  sizeBytes: 10,
                  sha256: 'b'.repeat(64),
                },
              },
            ],
          }),
        ],
      },
    })

    expect(tasks.map((item) => item.id)).toEqual([
      'safe',
      'unsafe-step-artifact',
    ])
    expect(tasks[1]?.steps).toHaveLength(1)
    expect(tasks[1]?.steps[0]).toMatchObject({
      toolName: 'download',
      previewText: 'Downloaded file',
      artifact: undefined,
    })
  })

  test('projects only strict artifact descriptors from task and step records', () => {
    const descriptor = {
      artifactId: '00000000-0000-4000-8000-000000000001',
      filename: 'report.csv',
      sizeBytes: 8,
      sha256: 'a'.repeat(64),
    }
    const tasks = flattenExecutionHistory({
      history: {
        conversationId: 'history',
        updatedAt: 1,
        tasks: [
          task('safe-artifact', '2026-10-27T00:00:00.000Z', {
            artifacts: [descriptor],
          }),
          task('credential-filename', '2026-10-26T00:00:00.000Z', {
            artifacts: [{ ...descriptor, filename: 'api_key=fixture.txt' }],
          }),
          task('path-filename', '2026-10-25T00:00:00.000Z', {
            artifacts: [{ ...descriptor, filename: '../outside.txt' }],
          }),
          task('dot-filename', '2026-10-24T12:00:00.000Z', {
            artifacts: [{ ...descriptor, filename: '.' }],
          }),
          task('dotdot-filename', '2026-10-24T06:00:00.000Z', {
            artifacts: [{ ...descriptor, filename: '..' }],
          }),
          task('invalid-size', '2026-10-24T00:00:00.000Z', {
            artifacts: [{ ...descriptor, sizeBytes: -1 }],
          }),
          task('invalid-hash', '2026-10-23T00:00:00.000Z', {
            artifacts: [{ ...descriptor, sha256: 'not-a-hash' }],
          }),
          task('invalid-id', '2026-10-22T00:00:00.000Z', {
            artifacts: [{ ...descriptor, artifactId: 'not-a-uuid' }],
          }),
          task('invalid-step-descriptor', '2026-10-21T00:00:00.000Z', {
            steps: [
              {
                id: 'download',
                toolName: 'download',
                order: 1,
                state: 'output-available',
                startedAt: '2026-10-21T00:00:00.000Z',
                previewText: 'Downloaded safely',
                artifact: { ...descriptor, sizeBytes: Number.NaN },
              },
              {
                id: 'safe-download',
                toolName: 'download',
                order: 2,
                state: 'output-available',
                startedAt: '2026-10-21T00:00:01.000Z',
                previewText: 'Downloaded another file safely',
                artifact: descriptor,
              },
            ],
          }),
        ],
      },
    })
    expect(tasks.map((item) => item.id)).toEqual([
      'safe-artifact',
      'credential-filename',
      'path-filename',
      'dot-filename',
      'dotdot-filename',
      'invalid-size',
      'invalid-hash',
      'invalid-id',
      'invalid-step-descriptor',
    ])
    expect(tasks.map((item) => item.artifacts)).toEqual([
      [descriptor],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ])
    expect(tasks[8]?.steps).toMatchObject([
      {
        previewText: 'Downloaded safely',
        artifact: undefined,
      },
      {
        previewText: 'Downloaded another file safely',
        artifact: descriptor,
      },
    ])
    expect(tasks[8]?.steps.map((step) => step.artifact)).toEqual([
      undefined,
      descriptor,
    ])
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

  test('projects empty and partial saved records to only available display fields', () => {
    const empty = getTaskDisplayRecord(
      task('empty', '2026-10-27T00:00:00.000Z', {
        promptText: '',
        responseText: undefined,
        responsePreview: undefined,
        steps: [],
      }),
    )
    const partial = getTaskDisplayRecord(
      task('partial', '2026-10-27T00:00:00.000Z', {
        responseText: undefined,
        responsePreview: 'Saved response',
        steps: [
          {
            id: 'summary',
            toolName: 'browser.click',
            order: 1,
            state: 'output-available',
            startedAt: '2026-10-27T00:00:00.000Z',
            previewText: 'Clicked the visible button',
            input: { secretSentinel: 'RAW_TOOL_INPUT_SENTINEL' },
            output: { secretSentinel: 'RAW_TOOL_OUTPUT_SENTINEL' },
          },
        ],
      }),
    )

    expect(empty.promptText).toBe('')
    expect(empty.steps).toEqual([])
    expect(getTaskTranscriptResponse(empty)).toBe('')
    expect(partial.responsePreview).toBe('Saved response')
    expect(partial.steps[0]).toMatchObject({
      toolName: 'browser.click',
      previewText: 'Clicked the visible button',
      input: undefined,
      output: undefined,
    })
    expect(JSON.stringify(partial)).not.toContain('RAW_TOOL_')
  })

  test('omits known credential sentinels and source paths while preserving safe fields', () => {
    const projected = getTaskDisplayRecord(
      task('credential-bearing', '2026-10-27T00:00:00.000Z', {
        promptText: 'Use API key: fixture-not-real',
        responseText: 'Visit https://example.com/docs/path for details',
        steps: [
          {
            id: 'credential-summary',
            toolName: 'browser.click',
            order: 1,
            state: 'output-available',
            startedAt: '2026-10-27T00:00:00.000Z',
            previewText: 'Bearer abcdefghijklmnopqrstuvwxyz',
          },
          {
            id: 'path-summary',
            toolName: 'filesystem.read',
            order: 2,
            state: 'output-available',
            startedAt: '2026-10-27T00:00:00.000Z',
            previewText: 'Read (/home/alice/private.txt)',
          },
          {
            id: 'workspace-path',
            toolName: 'filesystem.read',
            order: 3,
            state: 'output-available',
            startedAt: '2026-10-27T00:00:00.000Z',
            previewText: 'Read /workspace/project/config.json',
          },
          {
            id: 'windows-path',
            toolName: 'filesystem.read',
            order: 4,
            state: 'output-available',
            startedAt: '2026-10-27T00:00:00.000Z',
            previewText: 'Read [C:\\Users\\alice\\secret.txt]',
          },
          {
            id: 'safe-summary',
            toolName: 'browser.click',
            order: 5,
            state: 'output-available',
            startedAt: '2026-10-27T00:00:00.000Z',
            previewText: 'Clicked submit',
          },
        ],
      }),
    )

    expect(projected.promptText).toBe('')
    expect(projected.responseText).toBe(
      'Visit https://example.com/docs/path for details',
    )
    expect(projected.steps.map((step) => step.id)).toEqual(['safe-summary'])
    const renderedText = JSON.stringify(projected)
    expect(renderedText).not.toContain('fixture-not-real')
    expect(renderedText).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(renderedText).not.toContain('/home/alice')
    expect(renderedText).not.toContain('/workspace/project')
    expect(renderedText).not.toContain('C:\\Users\\alice')
  })

  test('omits an approval reason containing credential-shaped text', () => {
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

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.steps[0]?.approval?.reason).toBeUndefined()
  })

  test('omits error text matching a known credential pattern', () => {
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

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.steps[0]?.errorText).toBeUndefined()
  })
})
