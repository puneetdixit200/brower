import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../types'
import { isLocalhostRequest } from './security'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:'])

export function isTrustedAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false

  try {
    const url = new URL(origin)

    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      LOOPBACK_HOSTS.has(url.hostname)
    ) {
      return true
    }

    return EXTENSION_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

export function requireTrustedAppOrigin(
  options: {
    requireOrigin?: boolean
    allowOriginlessTaskStateRead?: boolean
  } = {},
): MiddlewareHandler {
  return async (c, next) => {
    if (
      options.allowOriginlessTaskStateRead &&
      isChatTaskStateRead(c) &&
      !c.req.header('origin')
    ) {
      if (isHeaderlessExtensionStateRead(c)) return next()
      return c.json({ error: 'Forbidden' }, 403)
    }

    if (
      (!options.requireOrigin || c.req.header('origin')) &&
      isTrustedAppRequest(c)
    ) {
      return next()
    }

    return c.json({ error: 'Forbidden' }, 403)
  }
}

function isChatTaskStateRead(c: Context<Env>): boolean {
  if (c.req.method !== 'GET') return false
  const segments = new URL(c.req.url).pathname.split('/').filter(Boolean)
  return (
    (segments.length === 2 && segments[1] === 'state') ||
    (segments.length === 3 && segments[0] === 'chat' && segments[2] === 'state')
  )
}

function isHeaderlessExtensionStateRead(c: Context<Env>): boolean {
  return (
    c.req.method === 'GET' &&
    !c.req.header('origin') &&
    !c.req.header('referer') &&
    c.req.header('sec-fetch-site') === 'none' &&
    isLocalhostRequest(c)
  )
}

export function isTrustedAppRequest(c: Context<Env>): boolean {
  if (!isLocalhostRequest(c)) return false

  const origin = c.req.header('origin')
  if (origin) return isTrustedAppOrigin(origin)

  return ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
}
