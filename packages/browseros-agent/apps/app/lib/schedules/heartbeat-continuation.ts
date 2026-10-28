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
