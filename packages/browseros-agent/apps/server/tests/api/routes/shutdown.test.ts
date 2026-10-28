/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it, mock } from 'bun:test'
import { createShutdownRoute } from '../../../src/api/routes/shutdown'

const loopback = (address = '127.0.0.1') =>
  ({ server: { requestIP: () => ({ address }) } }) as never

describe('createShutdownRoute', () => {
  it('accepts loopback hosts with valid optional ports', async () => {
    const onShutdown = mock(() => {})
    const route = createShutdownRoute({ onShutdown })
    for (const host of ['localhost:1', '127.0.0.1:32123', 'localhost:65535']) {
      const response = await route.request(
        '/',
        { method: 'POST', headers: { Host: host } },
        loopback(),
      )
      expect(response.status).toBe(200)
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onShutdown).toHaveBeenCalledTimes(3)
  })

  it('preserves the originless loopback C++ restart request', async () => {
    const onShutdown = mock(() => {})
    const route = createShutdownRoute({ onShutdown })

    const response = await route.request(
      '/',
      { method: 'POST', headers: { Host: 'localhost' } },
      loopback(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
    expect(onShutdown).not.toHaveBeenCalled()

    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(onShutdown).toHaveBeenCalledTimes(1)
  })

  it('rejects non-loopback peers, forged hosts, and untrusted origins without shutdown', async () => {
    const onShutdown = mock(() => {})
    const route = createShutdownRoute({ onShutdown })
    const denied = [
      { headers: { Host: 'localhost' }, env: loopback('192.0.2.10') },
      { headers: { Host: 'attacker.example' }, env: loopback() },
      { headers: { Host: 'localhost:bogus' }, env: loopback() },
      { headers: { Host: 'localhost:0' }, env: loopback() },
      { headers: { Host: '127.0.0.1:65536' }, env: loopback() },
      { headers: { Host: 'localhost:123456' }, env: loopback() },
      {
        headers: {
          Host: '127.0.0.1',
          Origin: 'https://attacker.example',
        },
        env: loopback(),
      },
    ]

    for (const request of denied) {
      const response = await route.request(
        '/',
        { method: 'POST', headers: request.headers },
        request.env,
      )
      expect(response.status).toBe(403)
    }

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(onShutdown).not.toHaveBeenCalled()
  })
})
