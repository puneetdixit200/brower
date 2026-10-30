import type { ExecutionRecoveryMarker } from './recovery'
import {
  browserStartupRecoveryMarkerKey,
  isExecutionRecoveryMarker,
} from './recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from './types'

const HISTORY_KEY = 'executionHistoryByConversation'

export interface BrowserStartupRecoveryStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

function isPersistedHistory(
  value: unknown,
): value is ExecutionHistoryByConversation {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isRecoverableConversation(
  value: unknown,
): value is ExecutionHistoryByConversation[string] {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    Array.isArray(value.tasks)
  )
}

function isRecoverableTask(value: unknown): value is ExecutionTaskRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.startedAt === 'string' &&
    (value.status === 'running' ||
      value.status === 'completed' ||
      value.status === 'failed' ||
      value.status === 'stopped' ||
      value.status === 'interrupted')
  )
}

function hasStartedBefore(
  task: ExecutionTaskRecord,
  startupTimeMs: number,
): boolean {
  const startedAt = Date.parse(task.startedAt)
  return Number.isFinite(startedAt) && startedAt < startupTimeMs
}

/** Create local-only markers for running tasks that predate browser startup. */
export function createBrowserStartupRecoveryMarkers(
  history: ExecutionHistoryByConversation,
  startupAt: string,
): ExecutionRecoveryMarker[] {
  const startupTimeMs = Date.parse(startupAt)
  if (!Number.isFinite(startupTimeMs)) return []

  return Object.values(history).flatMap((entry) => {
    if (!isRecoverableConversation(entry)) return []
    return entry.tasks.flatMap((value) => {
      if (!isRecoverableTask(value)) return []
      const task = value
      return task.status === 'running' && hasStartedBefore(task, startupTimeMs)
        ? [
            {
              taskId: task.id,
              conversationId: entry.conversationId,
              status: 'interrupted' as const,
              completedAt: startupAt,
              source: 'browser-startup' as const,
            },
          ]
        : []
    })
  })
}

/**
 * Persist only per-task markers for still-running work from the prior browser
 * process. A separate key namespace prevents races with server-state markers.
 */
export async function persistBrowserStartupRecoveryMarkers(
  storage: BrowserStartupRecoveryStorage,
  startupAt: string,
): Promise<void> {
  const initial = await storage.get(HISTORY_KEY)
  if (!isPersistedHistory(initial[HISTORY_KEY])) return
  const candidates = createBrowserStartupRecoveryMarkers(
    initial[HISTORY_KEY],
    startupAt,
  )
  if (candidates.length === 0) return

  // Re-read before writing so a task created after the startup event, or a task
  // that reached a terminal state meanwhile, is never marked interrupted.
  const latest = await storage.get(HISTORY_KEY)
  if (!isPersistedHistory(latest[HISTORY_KEY])) return
  const stillRunning = new Set(
    Object.values(latest[HISTORY_KEY]).flatMap((entry) => {
      if (!isRecoverableConversation(entry)) return []
      return entry.tasks
        .filter(isRecoverableTask)
        .filter(
          (task) =>
            task.status === 'running' &&
            hasStartedBefore(task, Date.parse(startupAt)),
        )
        .map((task) => `${entry.conversationId}:${task.id}`)
    }),
  )
  const eligible = candidates.filter((marker) =>
    stillRunning.has(`${marker.conversationId}:${marker.taskId}`),
  )
  if (eligible.length === 0) return

  const keys = eligible.map((marker) =>
    browserStartupRecoveryMarkerKey(marker.taskId),
  )
  const existing = await storage.get(keys)
  const entries = Object.fromEntries(
    eligible.flatMap((marker) => {
      const key = browserStartupRecoveryMarkerKey(marker.taskId)
      const current = existing[key]
      if (
        isExecutionRecoveryMarker(current) &&
        current.taskId === marker.taskId &&
        current.conversationId === marker.conversationId &&
        current.source === 'browser-startup'
      ) {
        return []
      }
      return [[key, marker]]
    }),
  )
  if (Object.keys(entries).length > 0) await storage.set(entries)
}
