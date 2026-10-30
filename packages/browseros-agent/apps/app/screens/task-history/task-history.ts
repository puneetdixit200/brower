import { containsCredentialShapedText } from '@/lib/execution-history/safety'
import type {
  ExecutionHistoryByConversation,
  ExecutionStepRecord,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'

/** Filesystem paths are not useful transcript text and can reveal local data. */
function containsSourcePath(value: string): boolean {
  return (
    /(?:^|[\s"'=([{,;])file:\/\//i.test(value) ||
    /(?:^|[\s"'=([{,;])\/(?!\/)(?:[^/\s)\]},;]+\/)*[^/\s)\]},;]+/.test(value) ||
    /(?:^|[\s"'=([{,;])[A-Za-z]:\\(?:[^\\/\s)\]},;]+\\)*[^\\/\s)\]},;]+/.test(
      value,
    )
  )
}

function safeText(value?: string): string | undefined {
  if (!value?.trim()) return undefined
  return containsCredentialShapedText(value) || containsSourcePath(value)
    ? undefined
    : value
}

function safeStep(step: ExecutionStepRecord): ExecutionStepRecord | undefined {
  const toolName = safeText(step.toolName)
  const previewText = safeText(step.previewText)
  if (!toolName || !previewText) return undefined
  const errorText = safeText(step.errorText)
  const reason = safeText(step.approval?.reason)
  return {
    ...step,
    toolName,
    previewText,
    errorText,
    approval: step.approval ? { ...step.approval, reason } : undefined,
    // Stored raw tool I/O is never part of the detail view projection.
    input: undefined,
    output: undefined,
  }
}

/** Build the safe text projection used by task rows and task detail. */
export function getTaskDisplayRecord(
  task: ExecutionTaskRecord,
): ExecutionTaskRecord {
  const promptText = safeText(task.promptText) ?? ''
  const responseText = safeText(task.responseText)
  const responsePreview = safeText(task.responsePreview)
  return {
    ...task,
    promptText,
    responseText,
    responsePreview,
    steps: task.steps.flatMap((step) => {
      const safe = safeStep(step)
      return safe ? [safe] : []
    }),
  }
}

function hasSafeArtifactDescriptors(task: ExecutionTaskRecord): boolean {
  return (
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
        !step.artifact || !containsCredentialShapedText(step.artifact.filename),
    )
  )
}

/** Strict whole-record check retained for report export. */
export function isSafeTaskForDisplay(task: ExecutionTaskRecord): boolean {
  return (
    hasSafeArtifactDescriptors(task) &&
    !containsCredentialShapedText(task.promptText) &&
    !containsCredentialShapedText(task.responseText ?? '') &&
    !containsCredentialShapedText(task.responsePreview ?? '') &&
    task.steps.every(
      (step) =>
        !containsCredentialShapedText(step.toolName) &&
        !containsCredentialShapedText(step.previewText) &&
        !containsCredentialShapedText(step.errorText ?? '') &&
        !containsCredentialShapedText(step.approval?.reason ?? ''),
    )
  )
}

/** Flatten local execution history into newest-first task rows. */
export function flattenExecutionHistory(
  history: ExecutionHistoryByConversation | undefined,
): ExecutionTaskRecord[] {
  return Object.values(history ?? {})
    .flatMap((conversation) => conversation.tasks ?? [])
    .filter(hasSafeArtifactDescriptors)
    .map(getTaskDisplayRecord)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

export function getTaskResult(task: ExecutionTaskRecord): string {
  return task.responsePreview?.trim() || ''
}

/** Return the locally persisted final response for the transcript view. */
export function getTaskTranscriptResponse(task: ExecutionTaskRecord): string {
  const safe = getTaskDisplayRecord(task)
  return safe.responseText?.trim() || safe.responsePreview?.trim() || ''
}
