import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'

function containsCredentialShapedText(value: string): boolean {
  return (
    /-----BEGIN (?:(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----/.test(
      value,
    ) ||
    /\b(password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token)\s*[:=]/i.test(
      value,
    ) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i.test(value) ||
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(
      value,
    ) ||
    /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/.test(value) ||
    /\bxapp-[A-Za-z0-9-]{20,}\b/.test(value) ||
    /\bgithub_pat_[A-Za-z0-9_-]{50,}\b/.test(value) ||
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
    (task.artifacts ?? []).every(
      (artifact) =>
        !containsCredentialShapedText(artifact.filename) &&
        !/[\\/\0]/.test(artifact.filename) &&
        Number.isSafeInteger(artifact.sizeBytes) &&
        artifact.sizeBytes >= 0 &&
        /^[a-f0-9]{64}$/i.test(artifact.sha256) &&
        (!artifact.artifactId || /^[a-f0-9-]{36}$/i.test(artifact.artifactId)),
    ) &&
    task.steps.every(
      (step) =>
        !containsCredentialShapedText(step.toolName) &&
        !containsCredentialShapedText(step.previewText) &&
        !containsCredentialShapedText(step.errorText ?? '') &&
        !containsCredentialShapedText(step.approval?.reason ?? '') &&
        (!step.artifact ||
          !containsCredentialShapedText(step.artifact.filename)),
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

/** Return the locally persisted final response for the transcript view. */
export function getTaskTranscriptResponse(task: ExecutionTaskRecord): string {
  return task.responseText?.trim() || getTaskResult(task)
}
