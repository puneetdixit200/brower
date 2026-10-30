import {
  applyExecutionRecoveryMarkers,
  browserStartupRecoveryMarkerKey,
  type ExecutionRecoveryMarker,
  executionRecoveryMarkerKey,
  getExecutionRecoveryMarker,
} from '@/lib/execution-history/recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionStepRecord,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'
import {
  flattenExecutionHistory,
  isSafeTaskForRecentCard,
} from '@/screens/task-history/task-history'

const MAX_RECENT_TASKS = 3
const HISTORY_KEY = 'executionHistoryByConversation'

/** The small part of chrome.storage.local used by Recent Tasks. */
export interface RecentTasksStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>
}

/** Build the newest safe task cards after applying matching recovery markers. */
export function buildRecentTasks(
  history: ExecutionHistoryByConversation,
  markers: ExecutionRecoveryMarker[],
) {
  const markedHistory = applyExecutionRecoveryMarkers(history, markers)
  const safeHistory = Object.fromEntries(
    Object.entries(markedHistory).map(([key, conversation]) => [
      key,
      {
        ...conversation,
        tasks: conversation.tasks.filter(isSafeTaskForRecentCard),
      },
    ]),
  )
  return flattenExecutionHistory(safeHistory).slice(0, MAX_RECENT_TASKS)
}

function isHistory(value: unknown): value is ExecutionHistoryByConversation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (conversation) =>
      !!conversation &&
      typeof conversation === 'object' &&
      !Array.isArray(conversation) &&
      typeof (conversation as { conversationId?: unknown }).conversationId ===
        'string' &&
      typeof (conversation as { updatedAt?: unknown }).updatedAt === 'number' &&
      Array.isArray((conversation as { tasks?: unknown }).tasks) &&
      (conversation as { tasks: unknown[] }).tasks.every(
        (task) =>
          isTaskRecord(task) &&
          task.conversationId ===
            (conversation as { conversationId: string }).conversationId,
      ),
  )
}

function isArtifactDescriptor(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const artifact = value as Record<string, unknown>
  return (
    typeof artifact.filename === 'string' &&
    typeof artifact.sizeBytes === 'number' &&
    typeof artifact.sha256 === 'string' &&
    (artifact.artifactId === undefined ||
      typeof artifact.artifactId === 'string')
  )
}

function isStepRecord(value: unknown): value is ExecutionStepRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const step = value as Record<string, unknown>
  return (
    typeof step.id === 'string' &&
    typeof step.toolName === 'string' &&
    typeof step.order === 'number' &&
    (step.state === 'input-streaming' ||
      step.state === 'input-available' ||
      step.state === 'approval-requested' ||
      step.state === 'approval-responded' ||
      step.state === 'output-available' ||
      step.state === 'output-error' ||
      step.state === 'output-denied') &&
    typeof step.startedAt === 'string' &&
    typeof step.previewText === 'string' &&
    (step.completedAt === undefined || typeof step.completedAt === 'string') &&
    (step.errorText === undefined || typeof step.errorText === 'string') &&
    (step.artifact === undefined || isArtifactDescriptor(step.artifact)) &&
    (step.approval === undefined ||
      (!!step.approval &&
        typeof step.approval === 'object' &&
        !Array.isArray(step.approval) &&
        typeof (step.approval as { id?: unknown }).id === 'string' &&
        ((step.approval as { approved?: unknown }).approved === undefined ||
          typeof (step.approval as { approved?: unknown }).approved ===
            'boolean') &&
        ((step.approval as { reason?: unknown }).reason === undefined ||
          typeof (step.approval as { reason?: unknown }).reason === 'string')))
  )
}

function isTaskRecord(value: unknown): value is ExecutionTaskRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Record<string, unknown>
  return (
    typeof task.id === 'string' &&
    typeof task.conversationId === 'string' &&
    typeof task.promptText === 'string' &&
    typeof task.startedAt === 'string' &&
    (task.serverRunId === undefined || typeof task.serverRunId === 'string') &&
    (task.promptMessageId === undefined ||
      typeof task.promptMessageId === 'string') &&
    (task.assistantMessageId === undefined ||
      typeof task.assistantMessageId === 'string') &&
    (task.completedAt === undefined || typeof task.completedAt === 'string') &&
    (task.responseText === undefined ||
      typeof task.responseText === 'string') &&
    (task.responsePreview === undefined ||
      typeof task.responsePreview === 'string') &&
    typeof task.actionCount === 'number' &&
    typeof task.approvalCount === 'number' &&
    typeof task.deniedCount === 'number' &&
    typeof task.errorCount === 'number' &&
    (task.status === 'running' ||
      task.status === 'completed' ||
      task.status === 'stopped' ||
      task.status === 'failed' ||
      task.status === 'interrupted') &&
    Array.isArray(task.steps) &&
    task.steps.every(isStepRecord) &&
    (task.artifacts === undefined ||
      (Array.isArray(task.artifacts) &&
        task.artifacts.every(isArtifactDescriptor)))
  )
}

/** Read persisted history and its matching recovery markers, then project cards. */
export async function loadRecentTasks(
  storage: RecentTasksStorage,
): Promise<ReturnType<typeof buildRecentTasks>> {
  const initial = await storage.get(HISTORY_KEY)
  const historyValue = initial[HISTORY_KEY]
  if (!isHistory(historyValue)) return []

  const running = Object.values(historyValue).flatMap((record) =>
    record.tasks.filter((task) => task.status === 'running'),
  )
  const keys = running.flatMap((task) => [
    executionRecoveryMarkerKey(task.id),
    browserStartupRecoveryMarkerKey(task.id),
  ])
  const storedMarkers = keys.length ? await storage.get(keys) : {}
  const markers = running.flatMap((task) => {
    const marker = getExecutionRecoveryMarker(
      task.id,
      task.conversationId,
      storedMarkers,
    )
    return marker ? [marker] : []
  })
  return buildRecentTasks(historyValue, markers)
}
