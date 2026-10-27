import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from './types'

export interface ExecutionRecoveryMarker {
  taskId: string
  conversationId: string
  status: 'interrupted'
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
    candidate.status === 'interrupted' &&
    typeof candidate.completedAt === 'string'
  )
}

/** Return per-task markers only when the server confirms the run is absent. */
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
  const missingRuns = new Set<string>()

  await Promise.all(
    uniqueConversationIds.map(async (conversationId) => {
      try {
        const response = await fetchImpl(
          `${serverUrl}/chat/${encodeURIComponent(conversationId)}/state`,
          { cache: 'no-store' },
        )
        if (response.status === 404) missingRuns.add(conversationId)
      } catch {
        // Startup and network failures do not prove that a run was lost.
      }
    }),
  )

  const completedAt = now()
  return runningConversations
    .filter((conversation) => missingRuns.has(conversation.conversationId))
    .flatMap((conversation) =>
      conversation.tasks
        .filter((task) => task.status === 'running')
        .map((task) => ({
          taskId: task.id,
          conversationId: conversation.conversationId,
          status: 'interrupted' as const,
          completedAt,
        })),
    )
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
        status: 'interrupted',
        completedAt: marker.completedAt,
      }
    })
    next[key] = tasks.some((task, index) => task !== conversation.tasks[index])
      ? { ...conversation, tasks }
      : conversation
  }

  return changed ? next : history
}
