export const EXECUTION_RUN_ID_HEADER = 'X-BrowserOS-Run-Id'

/** Capture the server-owned run identity before the transport consumes a chat stream. */
type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export function createExecutionHistoryFetch(
  associateServerRunId: (runId: string) => Promise<void>,
  fetchImpl: FetchImplementation = (input, init) =>
    globalThis.fetch(input, init),
): typeof globalThis.fetch {
  const fetchWithRunIdentity: FetchImplementation = async (input, init) => {
    const response = await fetchImpl(input, init)
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    const runId =
      method === 'POST' && response.status === 200
        ? response.headers.get(EXECUTION_RUN_ID_HEADER)?.trim()
        : undefined

    if (runId) await associateServerRunId(runId)
    return response
  }
  return fetchWithRunIdentity as typeof globalThis.fetch
}
