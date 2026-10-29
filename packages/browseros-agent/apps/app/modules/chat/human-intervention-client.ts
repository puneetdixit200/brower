import { resolveAgentServerUrl } from '@/modules/browseros/agent-server-url.helpers'

interface ResumeHumanInterventionInput {
  conversationId: string
  runId: string
  requestId: string
}

interface ResumeHumanInterventionDeps {
  resolveServerUrl?: typeof resolveAgentServerUrl
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>
  wait?: (milliseconds: number) => Promise<void>
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
