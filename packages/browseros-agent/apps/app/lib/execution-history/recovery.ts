import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from './types'

export interface ExecutionRecoveryMarker {
  taskId: string
  conversationId: string
  status: Exclude<ExecutionTaskRecord['status'], 'running'>
  completedAt: string
}

const RECOVERY_MARKER_PREFIX = 'executionHistoryRecovery:'

type RecoveryOptions = {
  serverUrl: string
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>
  now?: () => string
}

export function executionRecoveryMarkerKey(taskId: string): string {
  return `${RECOVERY_MARKER_PREFIX}${taskId}`
}

export function isExecutionRecoveryMarker(
  value: unknown,
): value is ExecutionRecoveryMarker {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.taskId === 'string' &&
    typeof candidate.conversationId === 'string' &&
    (candidate.status === 'completed' ||
      candidate.status === 'stopped' ||
      candidate.status === 'failed' ||
      candidate.status === 'interrupted') &&
    typeof candidate.completedAt === 'string'
  )
}

interface TerminalRunSnapshot {
  runId: string
  status: ExecutionRecoveryMarker['status']
}

function terminalTaskStatusFromSnapshot(
  snapshot: unknown,
  conversationId: string,
): TerminalRunSnapshot | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined
  const candidate = snapshot as Record<string, unknown>
  if (
    candidate.conversationId !== conversationId ||
    typeof candidate.runId !== 'string' ||
    candidate.runId.trim().length === 0 ||
    typeof candidate.chunkCount !== 'number' ||
    !Number.isFinite(candidate.chunkCount)
  ) {
    return undefined
  }

  switch (candidate.status) {
    case 'completed':
    case 'failed':
    case 'interrupted':
      return { runId: candidate.runId, status: candidate.status }
    case 'aborted':
      return { runId: candidate.runId, status: 'stopped' }
    default:
      return undefined
  }
}

/** Reconcile running local tasks against the server's current run state. */
export async function reconcileInterruptedExecutionTasks(
  history: ExecutionHistoryByConversation,
  {
    serverUrl,
    fetchImpl = fetch,
    now = () => new Date().toISOString(),
  }: RecoveryOptions,
): Promise<ExecutionRecoveryMarker[]> {
  const runningConversations = Object.values(history).filter((conversation) =>
    conversation.tasks.some((task) => task.status === 'running'),
  )
  const uniqueConversationIds = [
    ...new Set(runningConversations.map((item) => item.conversationId)),
  ]
  const terminalRuns = new Map<
    string,
    | { status: 'interrupted'; runId?: undefined }
    | { status: ExecutionRecoveryMarker['status']; runId: string }
  >()

  await Promise.all(
    uniqueConversationIds.map(async (conversationId) => {
      try {
        const response = await fetchImpl(
          `${serverUrl}/chat/${encodeURIComponent(conversationId)}/state`,
          { cache: 'no-store' },
        )
        if (response.status === 404) {
          terminalRuns.set(conversationId, {
            status: 'interrupted',
          })
        } else if (response.status === 200) {
          const snapshot: unknown = await response.json().catch(() => undefined)
          const terminalRun = terminalTaskStatusFromSnapshot(
            snapshot,
            conversationId,
          )
          if (terminalRun) terminalRuns.set(conversationId, terminalRun)
        }
      } catch {
        // Startup and network failures do not prove that a run was lost.
      }
    }),
  )

  const completedAt = now()
  return runningConversations.flatMap((conversation) => {
    const terminalRun = terminalRuns.get(conversation.conversationId)
    if (!terminalRun) return []
    return conversation.tasks
      .filter(
        (task) =>
          task.status === 'running' &&
          (terminalRun.runId === undefined ||
            task.serverRunId === terminalRun.runId),
      )
      .map((task) => ({
        taskId: task.id,
        conversationId: conversation.conversationId,
        status: terminalRun.status,
        completedAt,
      }))
  })
}

/** Overlay markers only on matching tasks that still exist and remain running. */
export function applyExecutionRecoveryMarkers(
  history: ExecutionHistoryByConversation,
  markers: ExecutionRecoveryMarker[],
): ExecutionHistoryByConversation {
  const markersByTaskId = new Map(
    markers.map((marker) => [marker.taskId, marker]),
  )
  let changed = false
  const next: ExecutionHistoryByConversation = {}

  for (const [key, conversation] of Object.entries(history)) {
    const tasks = conversation.tasks.map((task): ExecutionTaskRecord => {
      const marker = markersByTaskId.get(task.id)
      if (
        task.status !== 'running' ||
        !marker ||
        marker.conversationId !== conversation.conversationId
      ) {
        return task
      }
      changed = true
      return {
        ...task,
        status: marker.status,
        completedAt: marker.completedAt,
      }
    })
    next[key] = tasks.some((task, index) => task !== conversation.tasks[index])
      ? { ...conversation, tasks }
      : conversation
  }

  return changed ? next : history
}
