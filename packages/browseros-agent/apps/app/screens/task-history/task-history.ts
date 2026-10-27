import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'

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

/** Keep task prompts, results, tool names, and step previews safe for display. */
export function isSafeTaskForDisplay(task: ExecutionTaskRecord): boolean {
  return (
    !containsCredentialShapedText(task.promptText) &&
    !containsCredentialShapedText(task.responseText ?? '') &&
    !containsCredentialShapedText(task.responsePreview ?? '') &&
    task.steps.every(
      (step) =>
        !containsCredentialShapedText(step.toolName) &&
        !containsCredentialShapedText(step.previewText),
    )
  )
}

/** Flatten local execution history into newest-first task rows. */
export function flattenExecutionHistory(
  history: ExecutionHistoryByConversation | undefined,
): ExecutionTaskRecord[] {
  return Object.values(history ?? {})
    .flatMap((conversation) => conversation.tasks ?? [])
    .filter(isSafeTaskForDisplay)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

export function getTaskResult(task: ExecutionTaskRecord): string {
  return task.responsePreview?.trim() || ''
}
