import { describe, expect, it } from 'bun:test'
import {
  canDrainPromptQueue,
  clearPromptQueue,
  dispatchNextPrompt,
  enqueuePrompt,
  isPromptQueueRetryCurrent,
  MAX_QUEUED_PROMPTS,
  normalizeQueuedPrompt,
  removeQueuedPrompt,
} from './prompt-queue'

describe('per-chat prompt queue', () => {
  const verifyInvalidatedRetry = () => {
    const queue = enqueuePrompt([], 'stale')
    const scheduledPrompt = queue[0]
    const scheduledGeneration = 0
    const cleared = clearPromptQueue(scheduledGeneration)
    let dispatches = 0

    const retryIsCurrent = isPromptQueueRetryCurrent(
      cleared.queue,
      scheduledPrompt,
      scheduledGeneration,
      cleared.generation,
    )
    if (retryIsCurrent) {
      dispatchNextPrompt(cleared.queue, () => {
        dispatches += 1
        return true
      })
    }

    expect(retryIsCurrent).toBe(false)
    expect(dispatches).toBe(0)
    expect(cleared.queue).toEqual([])
  }

  it('drains FIFO once across submitted, streaming, and ready transitions', () => {
    let queue: string[] = []
    queue = enqueuePrompt(queue, ' first ')
    queue = enqueuePrompt(queue, 'second')
    const sent: string[] = []
    let inFlight = false

    for (const status of [
      'submitted',
      'streaming',
      'ready',
      'submitted',
      'streaming',
      'ready',
    ]) {
      if (!canDrainPromptQueue(status, true, queue.length, inFlight)) {
        if (status === 'submitted' || status === 'streaming') inFlight = false
        continue
      }
      inFlight = true
      const attempt = dispatchNextPrompt(queue, (prompt) => {
        sent.push(prompt)
        return true
      })
      expect(attempt.accepted).toBe(true)
      queue = attempt.remaining
    }

    expect(sent).toEqual(['first', 'second'])
    expect(queue).toEqual([])
  })

  it('keeps the head prompt for retry when sendMessage refuses, then removes it once accepted', () => {
    const queue = enqueuePrompt([], 'retry me')
    let inFlight = false
    let currentQueue = queue
    const sendMessage = (accepted: boolean) => (text: string) => {
      expect(text).toBe('retry me')
      return accepted
    }

    if (canDrainPromptQueue('ready', true, currentQueue.length, inFlight)) {
      inFlight = true
      const attempt = dispatchNextPrompt(currentQueue, sendMessage(false))
      if (!attempt.accepted) inFlight = false
      currentQueue = attempt.remaining
    }
    expect(currentQueue).toEqual(['retry me'])

    if (canDrainPromptQueue('ready', true, currentQueue.length, inFlight)) {
      inFlight = true
      const attempt = dispatchNextPrompt(currentQueue, sendMessage(true))
      if (attempt.accepted) currentQueue = attempt.remaining
    }
    expect(currentQueue).toEqual([])
  })

  it('Stop invalidates a scheduled refusal retry before it can dispatch', () => {
    verifyInvalidatedRetry()
  })

  it('Clear invalidates a scheduled refusal retry before it can dispatch', () => {
    verifyInvalidatedRetry()
  })

  it('caps the queue at five prompts and ignores blank prompts', () => {
    let queue: string[] = []
    for (let i = 1; i <= 7; i++) queue = enqueuePrompt(queue, ` prompt ${i} `)
    expect(queue).toHaveLength(MAX_QUEUED_PROMPTS)
    expect(queue).toEqual([
      'prompt 1',
      'prompt 2',
      'prompt 3',
      'prompt 4',
      'prompt 5',
    ])
    expect(enqueuePrompt(queue, '   ')).toBe(queue)
    expect(normalizeQueuedPrompt('\n\t')).toBeNull()
  })

  it('removes one selected prompt without changing the order of the rest', () => {
    const queue = ['first', 'remove me', 'last']
    expect(removeQueuedPrompt(queue, 1)).toEqual(['first', 'last'])
    expect(removeQueuedPrompt(queue, 1)).not.toBe(queue)
  })

  it('keeps the queue unchanged for an invalid removal index', () => {
    const queue = ['first', 'last']
    expect(removeQueuedPrompt(queue, -1)).toBe(queue)
    expect(removeQueuedPrompt(queue, 2)).toBe(queue)
    expect(removeQueuedPrompt(queue, 0.5)).toBe(queue)
  })
})
