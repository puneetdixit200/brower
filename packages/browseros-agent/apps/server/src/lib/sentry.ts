/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { createContentFreeTelemetryEvent } from '@browseros/shared/sentry/telemetry-event'
import type { ErrorEvent, Scope, User } from '@sentry/bun'
import * as SentrySdk from '@sentry/bun'

import { INLINED_ENV } from '../env'
import { VERSION } from '../version'
import {
  createSentryTransport,
  SentryTransportLease,
} from './privacy/sentry-transport'
import {
  isTelemetryEnabled,
  reloadTelemetryConsent,
} from './privacy/telemetry-consent'
import { createEventBudget } from './sentry-throttle'

const SENTRY_ENVIRONMENT = process.env.NODE_ENV || 'development'
let activeLease: SentryTransportLease | null = null
let activeRevision: string | null = null
let initialized = false
const eventBudget = createEventBudget()

export function enableTelemetrySentry(revision: string): void {
  if (!isTelemetryEnabled() || !INLINED_ENV.SENTRY_DSN || initialized) return
  let origin: string
  try {
    origin = new URL(INLINED_ENV.SENTRY_DSN).origin
  } catch {
    return
  }
  activeRevision = revision
  activeLease = new SentryTransportLease(origin, globalThis.fetch, async () => {
    const current = await reloadTelemetryConsent()
    return current.enabled && current.revision === activeRevision
  })
  initialized = true
  try {
    SentrySdk.init({
      dsn: INLINED_ENV.SENTRY_DSN,
      sendDefaultPii: false,
      environment: SENTRY_ENVIRONMENT,
      release: VERSION,
      transport: createSentryTransport(activeLease),
      beforeSend(event) {
        if (!isTelemetryEnabled() || !activeLease?.isValid()) return null
        if (eventBudget.admit(event as ErrorEvent) === null) return null
        return createContentFreeTelemetryEvent(event) as unknown as typeof event
      },
    })
  } catch {
    activeLease.revoke()
    activeLease = null
    activeRevision = null
    initialized = false
  }
}

export async function disableTelemetrySentry(): Promise<void> {
  activeLease?.revoke()
  activeLease = null
  activeRevision = null
  const wasInitialized = initialized
  initialized = false
  if (wasInitialized) {
    try {
      // The transport lease is revoked before the SDK closes, so close cannot
      // flush buffered events to the network.
      await SentrySdk.close(0)
    } catch {
      // Keep revocation effective even when SDK cleanup fails.
    }
  }
}

/** Capture facade: callers cannot bypass server-owned consent. */
export const Sentry = {
  captureException(error: unknown) {
    if (!isTelemetryEnabled() || !initialized || !activeLease?.isValid())
      return undefined
    return SentrySdk.captureException(error)
  },
  setUser(user: User | null) {
    if (isTelemetryEnabled() && initialized) return SentrySdk.setUser(user)
  },
  setContext(name: string, context: Record<string, unknown> | null) {
    if (isTelemetryEnabled() && initialized)
      return SentrySdk.setContext(name, context)
  },
  getCurrentScope(): Scope {
    return SentrySdk.getCurrentScope()
  },
  withScope(callback: (scope: Scope) => void): void {
    if (isTelemetryEnabled() && initialized) {
      SentrySdk.withScope(callback)
      return
    }
  },
}
