import { describe, expect, it } from 'bun:test'
import {
  canDrainPromptQueue,
  clearPromptQueue,
  dispatchNextPrompt,
  enqueuePrompt,
  isPromptQueueRetryCurrent,
  MAX_QUEUED_PROMPTS,
  normalizeQueuedPrompt,
  promptQueueForConversation,
  removeQueuedPrompt,
  replaceConversationPromptQueue,
  retryConversationPromptQueue,
  schedulePromptQueueRetry,
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

  it('retries a refused prompt after replacing its queue identity', () => {
    const queue = enqueuePrompt([], 'retry me')
    const queues = replaceConversationPromptQueue({}, 'conversation-a', queue)
    let attempts = 0

    const firstAttempt = dispatchNextPrompt(
      promptQueueForConversation(queues, 'conversation-a'),
      () => {
        attempts += 1
        return false
      },
    )
    expect(firstAttempt.accepted).toBe(false)
    expect(firstAttempt.remaining).toBe(queue)

    const retriedQueues = retryConversationPromptQueue(queues, 'conversation-a')
    expect(retriedQueues).not.toBe(queues)
    expect(
      promptQueueForConversation(retriedQueues, 'conversation-a'),
    ).not.toBe(queue)

    const retryAttempt = dispatchNextPrompt(
      promptQueueForConversation(retriedQueues, 'conversation-a'),
      () => {
        attempts += 1
        return true
      },
    )
    expect(retryAttempt.accepted).toBe(true)
    expect(retryAttempt.remaining).toEqual([])
    expect(attempts).toBe(2)
  })

  it('Stop invalidates a scheduled refusal retry before it can dispatch', () => {
    verifyInvalidatedRetry()
  })

  it('Clear invalidates a scheduled refusal retry before it can dispatch', () => {
    verifyInvalidatedRetry()
  })

  it('runs a refused-prompt retry after the scheduled delay', () => {
    const queue = enqueuePrompt([], 'retry me')
    let queues = replaceConversationPromptQueue({}, 'conversation-a', queue)
    const initialQueues = queues
    let retries = 0
    let scheduledDelay: number | undefined
    let timerCallback: (() => void) | undefined
    const timers = {
      setTimeout: (callback: () => void, delayMs: number) => {
        timerCallback = callback
        scheduledDelay = delayMs
        return 1
      },
      clearTimeout: () => {},
    }

    schedulePromptQueueRetry(
      () => {
        queues = retryConversationPromptQueue(queues, 'conversation-a')
        retries += 1
      },
      250,
      timers,
    )

    expect(retries).toBe(0)
    expect(scheduledDelay).toBe(250)
    expect(timerCallback).toBeDefined()
    timerCallback?.()
    expect(retries).toBe(1)
    expect(promptQueueForConversation(queues, 'conversation-a')).toEqual([
      'retry me',
    ])
    expect(queues).not.toBe(initialQueues)
  })

  it('cleans up the refusal retry timer when the effect is invalidated', () => {
    let cancelledHandle: number | undefined
    const retry = () => {}
    const cleanup = schedulePromptQueueRetry(retry, 250, {
      setTimeout: () => 42,
      clearTimeout: (handle) => {
        cancelledHandle = handle
      },
    })

    cleanup()
    expect(cancelledHandle).toBe(42)
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

describe('conversation-scoped prompt queues', () => {
  it('keeps queued prompts attached to their owning conversation', () => {
    const first = replaceConversationPromptQueue(
      {},
      'conversation-a',
      enqueuePrompt([], 'private queued work'),
    )

    expect(promptQueueForConversation(first, 'conversation-a')).toEqual([
      'private queued work',
    ])
    const otherChatQueue = promptQueueForConversation(first, 'conversation-b')
    expect(otherChatQueue).toEqual([])
    let crossConversationDispatches = 0
    const otherChatAttempt = dispatchNextPrompt(otherChatQueue, () => {
      crossConversationDispatches += 1
      return true
    })
    expect(otherChatAttempt.accepted).toBe(false)
    expect(crossConversationDispatches).toBe(0)

    const second = replaceConversationPromptQueue(
      first,
      'conversation-b',
      enqueuePrompt([], 'other chat work'),
    )
    expect(promptQueueForConversation(second, 'conversation-a')).toEqual([
      'private queued work',
    ])
    expect(promptQueueForConversation(second, 'conversation-b')).toEqual([
      'other chat work',
    ])
    expect(promptQueueForConversation(first, 'conversation-b')).toEqual([])
  })

  it('removes a conversation queue without changing another queue', () => {
    const queues = replaceConversationPromptQueue(
      replaceConversationPromptQueue({}, 'conversation-a', ['a']),
      'conversation-b',
      ['b'],
    )
    const cleared = replaceConversationPromptQueue(queues, 'conversation-a', [])

    expect(promptQueueForConversation(cleared, 'conversation-a')).toEqual([])
    expect(promptQueueForConversation(cleared, 'conversation-b')).toEqual(['b'])
  })
})
