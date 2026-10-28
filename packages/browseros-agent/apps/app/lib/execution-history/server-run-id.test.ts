import { describe, expect, it, mock } from 'bun:test'
import {
  createExecutionHistoryFetch,
  EXECUTION_RUN_ID_HEADER,
} from './server-run-id'

describe('execution history transport run identity', () => {
  it('persists the run id header before returning a successful chat response', async () => {
    let persisted = false
    const associateServerRunId = mock(async (_runId: string) => {
      await Promise.resolve()
      persisted = true
    })
    const fetchImpl = mock(
      async () =>
        new Response(null, {
          status: 200,
          headers: { [EXECUTION_RUN_ID_HEADER]: 'server-run-1' },
        }),
    )
    const fetchWithRunIdentity = createExecutionHistoryFetch(
      associateServerRunId,
      fetchImpl,
    )

    const response = await fetchWithRunIdentity('http://127.0.0.1:9000/chat', {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(persisted).toBe(true)
    expect(associateServerRunId).toHaveBeenCalledWith('server-run-1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not associate a run id for reconnects or unsuccessful responses', async () => {
    const associateServerRunId = mock(async (_runId: string) => {})
    const fetchImpl = mock(
      async () =>
        new Response(null, {
          status: 409,
          headers: { [EXECUTION_RUN_ID_HEADER]: 'server-run-1' },
        }),
    )
    const fetchWithRunIdentity = createExecutionHistoryFetch(
      associateServerRunId,
      fetchImpl,
    )

    await fetchWithRunIdentity('http://127.0.0.1:9000/chat', {
      method: 'GET',
    })
    await fetchWithRunIdentity('http://127.0.0.1:9000/chat', {
      method: 'POST',
    })

    expect(associateServerRunId).not.toHaveBeenCalled()
  })
})
