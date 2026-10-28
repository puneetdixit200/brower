/** Continue only from a completed turn; uncertain tool or approval state fails closed. */
export function mayContinueHeartbeat(previousStatus?: string): boolean {
  return previousStatus === undefined || previousStatus === 'completed'
}
