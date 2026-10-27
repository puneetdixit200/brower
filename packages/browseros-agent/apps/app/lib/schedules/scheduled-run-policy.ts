export const SCHEDULED_ALARM_GRACE_MS = 60_000

export function isAlarmWithinGracePeriod(
  scheduledTime: number,
  now: number,
): boolean {
  const lateness = now - scheduledTime
  return (
    Number.isFinite(scheduledTime) &&
    Number.isFinite(now) &&
    lateness >= 0 &&
    lateness <= SCHEDULED_ALARM_GRACE_MS
  )
}
