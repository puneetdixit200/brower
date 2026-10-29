import { describe, expect, it } from 'bun:test'
import { createSerializedMutationQueue } from './serializedMutationQueue'

describe('createSerializedMutationQueue', () => {
  it('runs mutations FIFO without overlapping them', async () => {
    const mutate = createSerializedMutationQueue()
    const events: string[] = []
    let active = 0
    let maximumActive = 0
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = mutate(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      events.push('first:start')
      await firstGate
      events.push('first:end')
      active -= 1
    })
    const second = mutate(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      events.push('second:start')
      active -= 1
      events.push('second:end')
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([first, second])

    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
    expect(maximumActive).toBe(1)
  })

  it('runs later mutations after an earlier mutation rejects', async () => {
    const mutate = createSerializedMutationQueue()
    const events: string[] = []
    const failure = new Error('mutation failed')

    const rejected = mutate(async () => {
      events.push('rejected')
      throw failure
    })
    const later = mutate(async () => {
      events.push('later')
      return 'completed'
    })

    await expect(rejected).rejects.toBe(failure)
    await expect(later).resolves.toBe('completed')
    expect(events).toEqual(['rejected', 'later'])
  })
})
