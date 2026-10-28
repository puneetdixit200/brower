/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it, mock } from 'bun:test'
import { createAsterCliRoutes } from '../../../src/api/routes/aster-cli'

const ACCESS_TOKEN = 'aster-cli-test-token-with-enough-entropy'

function createRoute() {
  const getSnapshot = mock((conversationId: string) =>
    conversationId === 'conversation_1'
      ? {
          conversationId,
          runId: 'run_1',
          status: 'running' as const,
          chunkCount: 3,
          prompt: 'private prompt must not be exposed',
          messages: [{ role: 'assistant', content: 'private response' }],
        }
      : null,
  )
  const stop = mock(async (conversationId: string) => {
    return conversationId === 'conversation_1'
  })
  const route = createAsterCliRoutes({
    runs: { getSnapshot, stop } as never,
    token: ACCESS_TOKEN,
  })

  return { getSnapshot, route, stop }
}

const auth = (token = ACCESS_TOKEN) => ({
  Authorization: `Bearer ${token}`,
})

describe('createAsterCliRoutes', () => {
  it('requires the configured bearer token before reading or stopping tasks', async () => {
    const { getSnapshot, route, stop } = createRoute()

    for (const headers of [undefined, {}, auth('wrong-token')]) {
      const status = await route.request('/task/conversation_1', { headers })
      const cancellation = await route.request('/task/conversation_1/stop', {
        method: 'POST',
        headers,
      })

      expect(status.status).toBe(401)
      expect(cancellation.status).toBe(401)
    }

    expect(getSnapshot).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('returns only task identity and status, not prompt or transcript content', async () => {
    const { getSnapshot, route } = createRoute()

    const response = await route.request('/task/conversation_1', {
      headers: auth(),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      conversationId: 'conversation_1',
      runId: 'run_1',
      status: 'running',
      chunkCount: 3,
    })
    expect(getSnapshot).toHaveBeenCalledWith('conversation_1')
  })

  it('cancels only on the explicit stop endpoint and reports the result', async () => {
    const { route, stop } = createRoute()

    const status = await route.request('/task/conversation_1', {
      headers: auth(),
    })
    const cancellation = await route.request('/task/conversation_1/stop', {
      method: 'POST',
      headers: auth(),
    })

    expect(status.status).toBe(200)
    expect(await cancellation.json()).toEqual({ stopped: true })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith('conversation_1')
  })

  it('keeps missing tasks and invalid identifiers bounded', async () => {
    const { route, stop } = createRoute()
    const missing = await route.request('/task/unknown', { headers: auth() })
    const invalid = await route.request(`/task/${'x'.repeat(181)}`, {
      headers: auth(),
    })

    expect(missing.status).toBe(404)
    expect(invalid.status).toBe(400)
    expect(stop).not.toHaveBeenCalled()
  })
})
