import { containsCredentialShapedText } from '@/lib/execution-history/safety'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'

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
