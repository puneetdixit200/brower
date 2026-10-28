/**
 * Read-only check for a heartbeat turn that may outlive an extension worker.
 * We only conclude "inactive" from the exact local Aster chat/state contract.
 * Network failures, unrecognized replies or a changed API all fail closed.
 */
export type ServerConversationLiveness = 'active' | 'inactive' | 'unknown'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getServerConversationLiveness(input: {
  conversationId: string
  agentServerUrl: string
  fetcher?: typeof fetch
  timeoutMs?: number
}): Promise<ServerConversationLiveness> {
  const { conversationId, agentServerUrl } = input
  if (!UUID_PATTERN.test(conversationId)) return 'unknown'

  let endpoint: URL
  try {
    const base = new URL(agentServerUrl)
    if (
      base.protocol !== 'http:' ||
      base.hostname !== '127.0.0.1' ||
      base.username ||
      base.password ||
      !base.port
    ) {
      return 'unknown'
    }
    endpoint = new URL(
      `/chat/${encodeURIComponent(conversationId)}/state`,
      base,
    )
  } catch {
    return 'unknown'
  }

  const controller = new AbortController()
  const timeoutMs = Math.max(100, Math.min(3000, input.timeoutMs ?? 1500))
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await (input.fetcher ?? fetch)(endpoint.toString(), {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.status !== 200 && response.status !== 404) return 'unknown'
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return 'unknown'
    const result = body as Record<string, unknown>
    if (response.status === 404) {
      return result.error === 'Conversation not found'
        ? 'inactive'
        : 'unknown'
    }
    if (result.conversationId !== conversationId) return 'unknown'
    if (result.status === 'running') return 'active'
    if (
      result.status === 'completed' ||
      result.status === 'aborted' ||
      result.status === 'failed' ||
      result.status === 'interrupted'
    ) {
      return 'inactive'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timeout)
  }
}
