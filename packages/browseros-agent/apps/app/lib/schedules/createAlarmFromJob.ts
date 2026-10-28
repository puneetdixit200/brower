import type { ScheduledJob } from './scheduleTypes'

export const getNextScheduledTime = (
  timeString: string,
  now: Date = new Date(),
): number => {
  const [hours, minutes] = timeString.split(':').map(Number)
  const scheduled = new Date(now)

  const setRequestedWallTime = () => scheduled.setHours(hours, minutes, 0, 0)
  setRequestedWallTime()

  // If time has passed today, schedule for tomorrow
  if (scheduled.getTime() <= now.getTime()) {
    scheduled.setDate(scheduled.getDate() + 1)
    // Reapply the requested time: on a DST gap, setting the wall time first
    // normalizes (for example) 02:30 to 03:30. Carrying that normalized time
    // into tomorrow would shift the schedule permanently.
    setRequestedWallTime()
  }

  return scheduled.getTime()
}

export const createAlarmFromJob = async (job: ScheduledJob) => {
  const alarmName = `scheduled-job-${job.id}`

  let time: chrome.alarms.AlarmCreateInfo | undefined

  if (job.scheduleType === 'daily' && job.scheduleTime) {
    time = {
      when: getNextScheduledTime(job.scheduleTime),
    }
  } else if (job.scheduleType === 'hourly' && job.scheduleInterval) {
    const intervalInMinutes = job.scheduleInterval * 60
    time = {
      delayInMinutes: intervalInMinutes,
      periodInMinutes: intervalInMinutes,
    }
  } else if (job.scheduleType === 'minutes' && job.scheduleInterval) {
    time = {
      delayInMinutes: job.scheduleInterval,
      periodInMinutes: job.scheduleInterval,
    }
  }
  if (time) {
    await chrome.alarms.create(alarmName, time)
  }
}
