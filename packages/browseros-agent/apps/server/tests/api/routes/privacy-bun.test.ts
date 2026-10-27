/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createApiRoutes } from '../../../src/api/routes'
import { KlavisService } from '../../../src/api/services/klavis'
import type { Env } from '../../../src/api/types'
import type { TelemetryConsent } from '../../../src/lib/privacy/telemetry-consent'

const TRUSTED_ORIGIN = 'chrome-extension://oifdmombnijnaiocijiacjhajbnpdlhb'
const servers: ReturnType<typeof Bun.serve>[] = []

function startServer() {
  let consent: TelemetryConsent = {
    enabled: false,
    revision: '00000000-0000-4000-8000-000000000001',
  }
  const app = createApiRoutes({
    config: {
      port: 0,
      version: '0.0.0-test',
      browser: { isCdpConnected: () => false },
      browserSession: {},
      executionDir: '/tmp/browseros-test',
      resourcesDir: '/tmp/browseros-resources',
      aiSdkDevtoolsEnabled: false,
    } as never,
    klavis: new KlavisService({ browserosId: null }),
    agentRoutes: new Hono<Env>(),
    onShutdown: () => {},
    tokenManager: null,
    privacy: {
      readConsent: () => consent,
      setConsent: async (enabled) => {
        consent = {
          enabled,
          revision: '00000000-0000-4000-8000-000000000002',
        }
        return consent
      },
      applyConsent: () => undefined,
    },
  })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => app.fetch(request, { server }),
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe('privacy routes on a real Bun server', () => {
  it('accepts trusted loopback read/write and denies originless or foreign origins', async () => {
    const baseUrl = startServer()

    const read = await fetch(`${baseUrl}/privacy/telemetry/state`, {
      method: 'POST',
      headers: { Origin: TRUSTED_ORIGIN },
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({
      enabled: false,
      revision: '00000000-0000-4000-8000-000000000001',
    })

    const write = await fetch(`${baseUrl}/privacy/telemetry`, {
      method: 'PUT',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    })
    expect(write.status).toBe(200)
    expect(await write.json()).toEqual({
      enabled: true,
      revision: '00000000-0000-4000-8000-000000000002',
    })

    const originless = await fetch(`${baseUrl}/privacy/telemetry/state`, {
      method: 'POST',
    })
    expect(originless.status).toBe(403)

    const foreign = await fetch(`${baseUrl}/privacy/telemetry/state`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    })
    expect(foreign.status).toBe(403)
  })
})
