import {
  applyExecutionRecoveryMarkers,
  type ExecutionRecoveryMarker,
} from '@/lib/execution-history/recovery'
import type { ExecutionHistoryByConversation } from '@/lib/execution-history/types'
import { flattenExecutionHistory } from '@/screens/task-history/task-history'

const MAX_RECENT_TASKS = 3

/** Build the newest safe task cards after applying matching recovery markers. */
export function buildRecentTasks(
  history: ExecutionHistoryByConversation,
  markers: ExecutionRecoveryMarker[],
) {
  return flattenExecutionHistory(
    applyExecutionRecoveryMarkers(history, markers),
  ).slice(0, MAX_RECENT_TASKS)
}
