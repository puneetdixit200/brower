/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono, type MiddlewareHandler } from 'hono'
import type { TelemetryConsent } from '../../lib/privacy/telemetry-consent'
import type { Env } from '../types'
import { isAllowedOrigin } from '../utils/cors'
import { isLocalhostRequest } from '../utils/security'

export interface PrivacyRouteDependencies {
  readConsent: () => TelemetryConsent | Promise<TelemetryConsent>
  setConsent: (enabled: boolean) => Promise<TelemetryConsent>
  applyConsent: (consent: TelemetryConsent) => Promise<void> | void
}

/** Owns the explicit, origin-bound telemetry consent API. */
export function createPrivacyRoutes(deps: PrivacyRouteDependencies): Hono<Env> {
  const app = new Hono<Env>()
  const handlers = createPrivacyHandlers(deps)
  app.post('/telemetry/state', handlers.read)
  app.put('/telemetry', handlers.write)
  return app
}

export function createPrivacyHandlers(deps: PrivacyRouteDependencies): {
  read: MiddlewareHandler<Env>
  write: MiddlewareHandler<Env>
} {
  let transitionTail: Promise<void> = Promise.resolve()
  const trustedLocalRequest = (c: Parameters<MiddlewareHandler<Env>>[0]) => {
    const origin = c.req.header('origin')
    return Boolean(origin && isAllowedOrigin(origin) && isLocalhostRequest(c))
  }

  const read: MiddlewareHandler<Env> = async (c) => {
    if (!trustedLocalRequest(c)) return c.json({ error: 'Forbidden' }, 403)
    if (c.req.raw.body !== null) {
      return c.json({ error: 'Request body is not allowed' }, 400)
    }
    return c.json(await deps.readConsent())
  }

  const write: MiddlewareHandler<Env> = async (c) => {
    if (!trustedLocalRequest(c)) return c.json({ error: 'Forbidden' }, 403)
    const contentType = c.req.header('content-type')?.split(';', 1)[0]?.trim()
    if (contentType?.toLowerCase() !== 'application/json') {
      return c.json({ error: 'Expected application/json' }, 415)
    }

    let value: unknown
    try {
      value = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    if (!isConsentRequest(value)) {
      return c.json({ error: 'Expected { enabled: boolean }' }, 400)
    }

    try {
      const transition = transitionTail.then(async () => {
        const consent = await deps.setConsent(value.enabled)
        await deps.applyConsent(consent)
        return consent
      })
      transitionTail = transition.then(
        () => undefined,
        () => undefined,
      )
      const consent = await transition
      return c.json(consent)
    } catch {
      // A failed write clears the store's in-memory grant. Revoke live senders
      // even though the caller receives an error for persistence failure.
      try {
        await deps.applyConsent(await deps.readConsent())
      } catch {
        // Keep the API's fail-closed response stable if shutdown hooks fail.
      }
      return c.json({ error: 'Unable to persist telemetry consent' }, 500)
    }
  }

  return { read, write }
}

function isConsentRequest(value: unknown): value is { enabled: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).enabled === 'boolean'
  )
}
