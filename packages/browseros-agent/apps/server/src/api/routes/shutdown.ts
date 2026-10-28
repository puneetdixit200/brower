/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { isAllowedOrigin } from '../utils/cors'
import { isLocalhostRequest } from '../utils/security'

interface ShutdownRouteConfig {
  onShutdown: () => void
}

function hasValidLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  const match = /^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/.exec(host)
  if (!match) return false
  if (match[2] === undefined) return true
  const port = Number(match[2])
  return port >= 1 && port <= 65_535
}

export function createShutdownRoute(config: ShutdownRouteConfig) {
  return new Hono<Env>().post('/', (c) => {
    const origin = c.req.header('origin')
    if (
      !hasValidLoopbackHost(c.req.header('host')) ||
      !isLocalhostRequest(c) ||
      (origin && !isAllowedOrigin(origin))
    ) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    // Shipped BrowserOS 0.46.x browsers call this from C++ managed restarts and require 200 + exit code 0; do not remove as unused.
    setImmediate(config.onShutdown)
    return c.json({ status: 'ok' })
  })
}
