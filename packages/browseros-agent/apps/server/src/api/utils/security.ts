/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Context } from 'hono'
import type { Env } from '../types'

const LOCALHOST_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const EXTENSION_REFERER_PROTOCOLS = new Set([
  'chrome-extension:',
  'moz-extension:',
])

export function isLocalhostRequest(c: Context<Env>): boolean {
  const server = c.env?.server
  if (!server) return false
  const request = c.req.raw

  const socketAddr = server.requestIP(request)
  if (!socketAddr || !LOCALHOST_ADDRESSES.has(socketAddr.address)) {
    return false
  }

  const host = c.req.header('host')
  if (!host) return false
  const hostname = host.split(':')[0]
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') return false

  const referer = c.req.header('referer')
  if (referer) {
    try {
      const url = new URL(referer)
      if (EXTENSION_REFERER_PROTOCOLS.has(url.protocol)) {
        const origin = c.req.header('origin')
        const refererOrigin = `${url.protocol}//${url.host}`
        if (
          !origin ||
          refererOrigin !== origin ||
          url.username.length > 0 ||
          url.password.length > 0
        ) {
          return false
        }
      } else if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        return false
      }
    } catch {
      return false
    }
  }

  return true
}
