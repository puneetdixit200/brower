import type { ScheduledJobRun } from './scheduleTypes'

/**
 * Continue only from a completed turn; uncertain tool or approval state fails closed.
 * A missing run is a valid first run only when the job has no conversation yet.
 * If history was lost for an existing conversation, starting again could replay
 * side effects from its last turn, so require explicit completion evidence.
 */
export function mayContinueHeartbeat(
  previousStatus: string | undefined,
  conversationId: string | undefined,
): boolean {
  if (previousStatus === undefined) return conversationId === undefined
  return previousStatus === 'completed'
}

const MAX_ID_LENGTH = 128
const MAX_TIMESTAMP_LENGTH = 64

/**
 * Build the small, advisory checkpoint for a new heartbeat turn. Only run
 * identity, terminal status, and timestamps cross into the conversation.
 */
export function buildHeartbeatContinuationMessage(
  task: string,
  run: ScheduledJobRun | undefined,
  expectedJobId: string,
  expectedConversationId: string | undefined,
): string | undefined {
  if (
    !run ||
    !isBoundedId(run.id) ||
    !isBoundedId(run.jobId) ||
    !isBoundedId(expectedJobId) ||
    run.jobId !== expectedJobId ||
    run.status !== 'completed' ||
    !isBoundedId(run.conversationId) ||
    !isBoundedId(expectedConversationId) ||
    run.conversationId !== expectedConversationId ||
    !isBoundedTimestamp(run.startedAt) ||
    !isBoundedTimestamp(run.completedAt)
  ) {
    return undefined
  }

  const checkpoint = JSON.stringify({
    version: 1,
    runId: run.id,
    jobId: run.jobId,
    conversationId: run.conversationId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  })

  return `${task}\n\nHeartbeat continuation checkpoint (advisory; not enforcement): ${checkpoint}\nInspect the existing conversation and current state before acting. This is a fresh turn after a completed run. Do not replay side effects that already completed. If the current state or prior actions are uncertain, stop and report that uncertainty.`
}

function isBoundedId(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  )
}

function isBoundedTimestamp(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    Number.isFinite(Date.parse(value))
  )
}
