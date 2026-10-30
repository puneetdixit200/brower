export const MAX_QUEUED_PROMPTS = 5

export type ConversationPromptQueues = Record<string, string[]>

const EMPTY_PROMPT_QUEUE: string[] = []

export function promptQueueForConversation(
  queues: ConversationPromptQueues,
  conversationId: string,
): string[] {
  return queues[conversationId] ?? EMPTY_PROMPT_QUEUE
}

export function replaceConversationPromptQueue(
  queues: ConversationPromptQueues,
  conversationId: string,
  queue: string[],
): ConversationPromptQueues {
  if (queues[conversationId] === queue) return queues
  const next = { ...queues }
  if (queue.length === 0) delete next[conversationId]
  else next[conversationId] = queue
  return next
}

export function retryConversationPromptQueue(
  queues: ConversationPromptQueues,
  conversationId: string,
): ConversationPromptQueues {
  const queue = queues[conversationId]
  if (!queue?.length) return queues
  return { ...queues, [conversationId]: [...queue] }
}

export function normalizeQueuedPrompt(prompt: string): string | null {
  const normalized = prompt.trim()
  return normalized || null
}

export function enqueuePrompt(queue: string[], prompt: string): string[] {
  const normalized = normalizeQueuedPrompt(prompt)
  if (!normalized || queue.length >= MAX_QUEUED_PROMPTS) return queue
  return [...queue, normalized]
}

export function takeNextPrompt(queue: string[]): {
  prompt: string | undefined
  remaining: string[]
} {
  return { prompt: queue[0], remaining: queue.slice(1) }
}

export function removeQueuedPrompt(queue: string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
    return queue
  }
  return queue.filter((_, queueIndex) => queueIndex !== index)
}

export function dispatchNextPrompt(
  queue: string[],
  send: (prompt: string) => boolean,
): { accepted: boolean; remaining: string[] } {
  const next = takeNextPrompt(queue)
  if (!next.prompt || !send(next.prompt)) {
    return { accepted: false, remaining: queue }
  }
  return { accepted: true, remaining: next.remaining }
}

export function isPromptQueueRetryCurrent(
  queue: string[],
  scheduledPrompt: string,
  scheduledGeneration: number,
  currentGeneration: number,
): boolean {
  return (
    scheduledGeneration === currentGeneration && queue[0] === scheduledPrompt
  )
}

export function schedulePromptQueueRetry(
  callback: () => void,
  delayMs: number,
  timers: {
    setTimeout: (callback: () => void, delayMs: number) => number
    clearTimeout: (handle: number) => void
  } = window,
): () => void {
  const handle = timers.setTimeout(callback, delayMs)
  return () => timers.clearTimeout(handle)
}

export function clearPromptQueue(generation: number): {
  queue: string[]
  generation: number
} {
  return { queue: [], generation: generation + 1 }
}

export function canDrainPromptQueue(
  status: string,
  canSend: boolean,
  queueLength: number,
  dispatchInFlight: boolean,
): boolean {
  return status === 'ready' && canSend && queueLength > 0 && !dispatchInFlight
}
