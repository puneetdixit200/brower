import { describe, expect, it } from 'bun:test'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import { createTaskMemoryDraft } from './task-memory-draft'

function task(
  overrides: Partial<ExecutionTaskRecord> = {},
): ExecutionTaskRecord {
  return {
    id: '019c6e27-e55b-73d1-87d8-4e01f1f75043',
    conversationId: '019c6e27-e55b-73d1-87d8-4e01f1f75044',
    promptText: 'Find the release branch',
    startedAt: '2026-10-27T00:00:00.000Z',
    completedAt: '2026-10-27T00:01:00.000Z',
    status: 'completed',
    responseText: 'The project deploys from the stable branch.',
    actionCount: 1,
    approvalCount: 0,
    deniedCount: 0,
    errorCount: 0,
    steps: [],
    ...overrides,
  }
}

describe('createTaskMemoryDraft', () => {
  it('creates a reviewable local draft with task provenance', () => {
    expect(createTaskMemoryDraft(task())).toEqual({
      content:
        'Task: Find the release branch\n\nResult: The project deploys from the stable branch.',
      sourceId: '019c6e27-e55b-73d1-87d8-4e01f1f75043',
      sourceTitle: 'Find the release branch',
    })
  })

  it('does not draft failed, stopped, or empty tasks', () => {
    expect(createTaskMemoryDraft(task({ status: 'failed' }))).toBeNull()
    expect(createTaskMemoryDraft(task({ status: 'stopped' }))).toBeNull()
    expect(createTaskMemoryDraft(task({ responseText: ' ' }))).toBeNull()
  })

  it('does not expose credential-shaped task titles or results as drafts', () => {
    expect(
      createTaskMemoryDraft(task({ promptText: 'Save API key: do-not-show' })),
    ).toBeNull()
    expect(
      createTaskMemoryDraft(
        task({
          responseText: 'Use this Bearer abcdefghijklmnopqrstuvwxyz123456',
        }),
      ),
    ).toBeNull()
    expect(
      createTaskMemoryDraft(
        task({
          responseText: undefined,
          responsePreview: 'AWS key AKIA1234567890ABCDEF',
        }),
      ),
    ).toBeNull()
  })

  it('bounds the draft size while retaining the task source', () => {
    const draft = createTaskMemoryDraft(
      task({ responseText: 'x'.repeat(12_000) }),
    )
    expect(draft?.content.length).toBeLessThanOrEqual(8_000)
    expect(draft?.sourceId).toBe(task().id)
  })
})
