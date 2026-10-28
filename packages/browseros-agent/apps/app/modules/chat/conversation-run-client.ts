import type { UIMessage } from 'ai'

export interface ConversationRunState {
  conversationId: string
  runId: string
  status: 'running' | 'completed' | 'aborted' | 'failed' | 'interrupted'
  /** Omitted for metadata-only snapshots after a server restart. */
  messages?: UIMessage[]
  startedAt?: number
  finishedAt?: number | null
}

/** Prefer a hydrated transcript; metadata-only snapshots must preserve a view's current messages. */
export function resolveConversationRunMessages(
  state: ConversationRunState,
  currentMessages: UIMessage[],
  persistedMessages?: UIMessage[],
): UIMessage[] {
  return state.messages ?? persistedMessages ?? currentMessages
}

export async function fetchConversationRunState(
  serverUrl: string,
  conversationId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ConversationRunState> {
  const response = await fetchImpl(
    `${serverUrl}/chat/${encodeURIComponent(conversationId)}/state`,
    { cache: 'no-store', ...(signal && { signal }) },
  )
  if (!response.ok) {
    throw new Error(`Failed to load active conversation (${response.status})`)
  }
  const value: unknown = await response.json()
  if (!isConversationRunState(value)) {
    throw new Error('Invalid active conversation state')
  }
  return value
}

export function conversationReconnectUrl(
  serverUrl: string,
  conversationId: string,
  runId?: string,
): string {
  const url = `${serverUrl}/chat/${encodeURIComponent(conversationId)}/stream`
  return runId ? `${url}?runId=${encodeURIComponent(runId)}` : url
}

function isConversationRunState(value: unknown): value is ConversationRunState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.conversationId === 'string' &&
    typeof candidate.runId === 'string' &&
    ['running', 'completed', 'aborted', 'failed', 'interrupted'].includes(
      String(candidate.status),
    ) &&
    (candidate.messages === undefined || Array.isArray(candidate.messages)) &&
    (candidate.startedAt === undefined ||
      typeof candidate.startedAt === 'number') &&
    (candidate.finishedAt === undefined ||
      candidate.finishedAt === null ||
      typeof candidate.finishedAt === 'number')
  )
}
