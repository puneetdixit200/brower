import { containsCredentialShapedText } from '@/lib/execution-history/safety'
import type {
  ExecutionArtifactDescriptor,
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

/** Recent-task cards keep the strict persisted-record gate before projection. */
export function isSafeTaskForRecentCard(task: ExecutionTaskRecord): boolean {
  return (
    isSafeTaskForDisplay(task) &&
    ![
      task.promptText,
      task.responseText ?? '',
      task.responsePreview ?? '',
      ...task.steps.flatMap((step) => [
        step.toolName,
        step.previewText,
        step.errorText ?? '',
        step.approval?.reason ?? '',
      ]),
    ].some(containsSourcePath)
  )
}

function safeText(value?: string): string | undefined {
  if (!value?.trim()) return undefined
  return containsCredentialShapedText(value) || containsSourcePath(value)
    ? undefined
    : value
}

/** Only well-formed, filename-safe descriptors may reach the task detail UI. */
function isSafeArtifactDescriptor(
  artifact: unknown,
): artifact is ExecutionArtifactDescriptor {
  if (typeof artifact !== 'object' || artifact === null) return false
  const descriptor = artifact as Partial<ExecutionArtifactDescriptor>
  return (
    typeof descriptor.filename === 'string' &&
    descriptor.filename.trim().length > 0 &&
    descriptor.filename !== '.' &&
    descriptor.filename !== '..' &&
    !containsCredentialShapedText(descriptor.filename) &&
    !/[\\/\0]/.test(descriptor.filename) &&
    typeof descriptor.sizeBytes === 'number' &&
    Number.isSafeInteger(descriptor.sizeBytes) &&
    descriptor.sizeBytes >= 0 &&
    typeof descriptor.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(descriptor.sha256) &&
    (descriptor.artifactId === undefined ||
      descriptor.artifactId === '' ||
      (typeof descriptor.artifactId === 'string' &&
        /^[a-f0-9-]{36}$/i.test(descriptor.artifactId)))
  )
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
    artifact:
      step.artifact && isSafeArtifactDescriptor(step.artifact)
        ? step.artifact
        : undefined,
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
    artifacts: (task.artifacts ?? []).filter(isSafeArtifactDescriptor),
    steps: task.steps.flatMap((step) => {
      const safe = safeStep(step)
      return safe ? [safe] : []
    }),
  }
}

function hasSafeArtifactDescriptors(task: ExecutionTaskRecord): boolean {
  return (
    (task.artifacts ?? []).every(isSafeArtifactDescriptor) &&
    task.steps.every(
      (step) => !step.artifact || isSafeArtifactDescriptor(step.artifact),
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
