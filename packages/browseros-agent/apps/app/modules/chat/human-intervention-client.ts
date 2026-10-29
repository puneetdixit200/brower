import { resolveAgentServerUrl } from '@/modules/browseros/agent-server-url.helpers'

interface ResumeHumanInterventionInput {
  conversationId: string
  runId: string
  requestId: string
}

interface StartFreshHumanInterventionInput
  extends ResumeHumanInterventionInput {}

interface ResumeHumanInterventionDeps {
  resolveServerUrl?: typeof resolveAgentServerUrl
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>
  wait?: (milliseconds: number) => Promise<void>
}

export interface HumanInterventionWait {
  runId: string
  requestId: string
  phase: 'waiting' | 'interrupted'
}

/** Reads the intervention currently attached to this exact conversation. */
export async function fetchHumanIntervention(
  conversationId: string,
  deps: Pick<
    ResumeHumanInterventionDeps,
    'resolveServerUrl' | 'fetchImpl'
  > = {},
  signal?: AbortSignal,
): Promise<HumanInterventionWait | null> {
  const resolveServerUrl = deps.resolveServerUrl ?? resolveAgentServerUrl
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    const serverUrl = await resolveServerUrl()
    const response = await fetchImpl(
      `${serverUrl}/chat/${encodeURIComponent(conversationId)}/intervention`,
      { signal },
    )
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object') return null
    const candidate = data as Record<string, unknown>
    if (candidate.runId === null && candidate.requestId === null) return null
    if (
      typeof candidate.runId !== 'string' ||
      candidate.runId.length === 0 ||
      typeof candidate.requestId !== 'string' ||
      candidate.requestId.length === 0
    )
      return null
    if (candidate.phase !== 'waiting' && candidate.phase !== 'interrupted') {
      return null
    }
    return {
      runId: candidate.runId,
      requestId: candidate.requestId,
      phase: candidate.phase,
    }
  } catch {
    return null
  }
}

/** Atomically consumes an interrupted wait and returns a new empty conversation identity. */
export async function startFreshHumanConversation(
  input: StartFreshHumanInterventionInput,
  deps: Pick<
    ResumeHumanInterventionDeps,
    'resolveServerUrl' | 'fetchImpl'
  > = {},
): Promise<ReturnType<typeof crypto.randomUUID> | null> {
  const resolveServerUrl = deps.resolveServerUrl ?? resolveAgentServerUrl
  const fetchImpl = deps.fetchImpl ?? fetch
  let serverUrl: string
  try {
    serverUrl = await resolveServerUrl()
  } catch {
    return null
  }

  const url = `${serverUrl}/chat/${encodeURIComponent(input.conversationId)}/intervention/${encodeURIComponent(input.requestId)}/fresh`
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: input.runId }),
    })
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object') return null
    const conversationId = (data as Record<string, unknown>).conversationId
    return typeof conversationId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        conversationId,
      )
      ? (conversationId as ReturnType<typeof crypto.randomUUID>)
      : null
  } catch {
    return null
  }
}

/** Retries the brief gap between the streamed tool call and its installed gate. */
export async function resumeHumanIntervention(
  input: ResumeHumanInterventionInput,
  deps: ResumeHumanInterventionDeps = {},
): Promise<boolean> {
  const resolveServerUrl = deps.resolveServerUrl ?? resolveAgentServerUrl
  const fetchImpl = deps.fetchImpl ?? fetch
  const wait =
    deps.wait ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)))
  let serverUrl: string
  try {
    serverUrl = await resolveServerUrl()
  } catch {
    return false
  }
  const url = `${serverUrl}/chat/${encodeURIComponent(input.conversationId)}/intervention/${encodeURIComponent(input.requestId)}/resume`

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: input.runId }),
      })
      if (response.ok) return (await response.json()).resumed === true
      if (response.status !== 409 || attempt === 3) return false
    } catch {
      return false
    }
    await wait(100)
  }
  return false
}
