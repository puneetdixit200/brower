import {
  applyExecutionRecoveryMarkers,
  type ExecutionRecoveryMarker,
} from '@/lib/execution-history/recovery'
import type { ExecutionHistoryByConversation } from '@/lib/execution-history/types'
import {
  flattenExecutionHistory,
  isSafeTaskForRecentCard,
} from '@/screens/task-history/task-history'

const MAX_RECENT_TASKS = 3

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
