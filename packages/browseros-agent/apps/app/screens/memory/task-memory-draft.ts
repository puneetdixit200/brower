import type { ExecutionTaskRecord } from '@/lib/execution-history/types'

export interface TaskMemoryDraft {
  content: string
  sourceId: string
  sourceTitle: string
}

const MAX_DRAFT_CHARS = 8_000

/** Build a local, user-reviewed draft from a completed task without an LLM call. */
export function createTaskMemoryDraft(
  task: ExecutionTaskRecord,
): TaskMemoryDraft | null {
  if (task.status !== 'completed') return null
  const result = task.responseText?.trim() || task.responsePreview?.trim()
  if (!result) return null

  const sourceTitle = task.promptText.trim().slice(0, 300)
  const content = [
    sourceTitle ? `Task: ${sourceTitle}` : '',
    `Result: ${result}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_DRAFT_CHARS)

  return {
    content,
    sourceId: task.id,
    sourceTitle: sourceTitle || 'Completed task',
  }
}
