import { describe, expect, it } from 'bun:test'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import { buildTaskReport } from './export-task-report'

const safeTask: ExecutionTaskRecord = {
  id: 'task-1',
  conversationId: 'conversation-1',
  promptText: 'Summarize this page',
  startedAt: '2026-10-28T10:00:00Z',
  completedAt: '2026-10-28T10:01:00Z',
  status: 'completed',
  responsePreview: 'Three paragraphs were summarized.',
  actionCount: 1,
  approvalCount: 0,
  deniedCount: 0,
  errorCount: 0,
  steps: [{
    id: 'step-1',
    toolName: 'snapshot',
    order: 0,
    state: 'output-available',
    startedAt: '2026-10-28T10:00:10Z',
    previewText: 'Read the visible page',
    input: { bearer: 'raw-input-never-exposed' },
    output: { secret: 'raw-output-never-exposed' },
  }],
}

describe('local task report export', () => {
  it('includes saved status and previews without exporting raw tool data', () => {
    const text = buildTaskReport(safeTask)
    expect(text).toContain('Status: completed')
    expect(text).toContain('Read the visible page')
    expect(text).not.toContain('raw-input-never-exposed')
    expect(text).not.toContain('raw-output-never-exposed')
  })

  it('refuses credential-shaped records instead of exporting them', () => {
    expect(() => buildTaskReport({
      ...safeTask,
      promptText: 'password: sensitive',
    })).toThrow('cannot be exported')
  })
})
