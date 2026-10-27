import type { ExecutionTaskRecord } from '@/lib/execution-history/types'

export interface TaskMemoryDraft {
  content: string
  sourceId: string
  sourceTitle: string
}

const MAX_DRAFT_CHARS = 8_000

function containsCredentialShapedText(value: string): boolean {
  return (
    /\b(password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token)\s*[:=]/i.test(
      value,
    ) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i.test(value) ||
    /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,})\b/.test(
      value,
    )
  )
}

/** Build a local, user-reviewed draft from a completed task without an LLM call. */
export function createTaskMemoryDraft(
  task: ExecutionTaskRecord,
): TaskMemoryDraft | null {
  if (task.status !== 'completed') return null
  const result = task.responseText?.trim() || task.responsePreview?.trim()
  if (!result) return null

  const rawTitle = task.promptText.trim()
  if (
    containsCredentialShapedText(rawTitle) ||
    containsCredentialShapedText(result)
  ) {
    return null
  }

  const sourceTitle = rawTitle.slice(0, 300)
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
