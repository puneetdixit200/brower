/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { expect, it } from 'bun:test'
import { KlavisClient } from '../../../../src/api/services/klavis/client'

it('does not copy a remote error body into the logged failure message', async () => {
  const originalFetch = globalThis.fetch
  const apiKey = 'SYNTHETIC_API_KEY_SENTINEL'
  let requestBody = ''
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? '')
    return new Response(`request rejected: ${apiKey}`, {
      status: 500,
      statusText: 'Internal Server Error',
    })
  }

  try {
    let failure: unknown
    try {
      await new KlavisClient('https://klavis.example').submitApiKey(
        'https://connect.example/auth?instance_id=instance-1',
        apiKey,
      )
    } catch (error) {
      failure = error
    }

    expect(requestBody).toContain(apiKey)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('HTTP 500')
    expect((failure as Error).message).not.toContain(apiKey)
    expect((failure as Error).message).not.toContain('request rejected')
  } finally {
    globalThis.fetch = originalFetch
  }
})
