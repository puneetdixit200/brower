import { createContentFreeTelemetryEvent } from '@browseros/shared/sentry/telemetry-event'
import * as Sentry from '@sentry/react'
import { getAgentServerUrl } from '../browseros/helpers'
import { isIncognitoWindow } from '../browseros/incognito'
import { env } from '../env'
import {
  hasCurrentTelemetryGrant,
  refreshTelemetryConsent,
  subscribeTelemetryConsent,
  type TelemetryConsent,
} from '../privacy/telemetry-consent'

/** Errors that are expected during normal operation should not be reported. */
const SUPPRESSED_ERRORS = ['The browser is shutting down', 'No current window']
let initializedRevision: string | null = null
let initPromise: Promise<void> | null = null
let desiredRevision: string | null = null
const inFlight = new Set<AbortController>()

function encodeEnvelope(envelope: unknown): string | null {
  if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return null
  const originalHeader = envelope[0]
  const header: Record<string, string> = {}
  if (originalHeader && typeof originalHeader === 'object') {
    const value = originalHeader as Record<string, unknown>
    if (
      typeof value.event_id === 'string' &&
      /^[0-9a-f-]{16,64}$/i.test(value.event_id)
    ) {
      header.event_id = value.event_id
    }
    if (
      typeof value.sent_at === 'string' &&
      /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(value.sent_at)
    ) {
      header.sent_at = value.sent_at
    }
  }
  const lines = [JSON.stringify(header)]
  for (const item of envelope[1]) {
    if (!Array.isArray(item) || item.length < 2) continue
    const [headers, payload] = item
    if (!headers || typeof headers !== 'object' || headers.type !== 'event')
      continue
    lines.push(
      JSON.stringify({ type: 'event', content_type: 'application/json' }),
      JSON.stringify(createContentFreeTelemetryEvent(payload)),
    )
  }
  return lines.length > 1 ? `${lines.join('\n')}\n` : null
}

function consentTransport(revision: string) {
  let valid = true
  const activeRequests = new Set<AbortController>()
  const revoke = () => {
    valid = false
    for (const controller of activeRequests) controller.abort()
    activeRequests.clear()
  }
  return (options: { url: string }) => ({
    async send(envelope: unknown) {
      if (!valid || !isApprovedSentryUrl(options.url)) {
        revoke()
        return { statusCode: 200 }
      }
      const body = encodeEnvelope(envelope)
      if (!body) return { statusCode: 200 }
      const controller = new AbortController()
      inFlight.add(controller)
      activeRequests.add(controller)
      try {
        if (!(await hasCurrentTelemetryGrant(revision))) {
          revoke()
          return { statusCode: 200 }
        }
        if (!valid) return { statusCode: 200 }
        const response = await fetch(options.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-sentry-envelope' },
          body,
          signal: controller.signal,
          redirect: 'error',
        })
        return {
          statusCode: response.status,
          headers: {
            'x-sentry-rate-limits': response.headers.get(
              'X-Sentry-Rate-Limits',
            ),
            'retry-after': response.headers.get('Retry-After'),
          },
        }
      } catch {
        return { statusCode: 200 }
      } finally {
        inFlight.delete(controller)
        activeRequests.delete(controller)
      }
    },
    async flush() {
      return true
    },
  })
}

function isApprovedSentryUrl(value: string): boolean {
  try {
    const dsn = new URL(env.VITE_PUBLIC_SENTRY_DSN ?? '')
    const destination = new URL(value)
    return (
      (dsn.protocol === 'https:' || dsn.protocol === 'http:') &&
      destination.origin === dsn.origin &&
      !destination.username &&
      !destination.password
    )
  } catch {
    return false
  }
}

async function initializeForConsent(
  consent: TelemetryConsent | null,
): Promise<void> {
  desiredRevision = consent?.enabled ? consent.revision : null
  if (!env.VITE_PUBLIC_SENTRY_DSN || !consent?.enabled) return
  if (initializedRevision === consent.revision || initPromise) return
  initPromise = (async () => {
    // Confirm the actual owning window before initializing. Unknown/incognito
    // contexts never initialize app Sentry, even with a profile-wide grant.
    if (await isIncognitoWindow()) return
    try {
      await getAgentServerUrl()
    } catch {
      return
    }
    if (!(await hasCurrentTelemetryGrant(consent.revision))) return
    Sentry.init({
      dsn: env.VITE_PUBLIC_SENTRY_DSN,
      sendDefaultPii: false,
      environment: env.PROD ? 'production' : 'development',
      release: chrome.runtime.getManifest().version,
      transport: consentTransport(consent.revision) as never,
      beforeSend(event) {
        const message = event.exception?.values?.[0]?.value ?? ''
        if (SUPPRESSED_ERRORS.some((s) => message.includes(s))) return null
        return createContentFreeTelemetryEvent(event) as unknown as typeof event
      },
      integrations: [],
    })
    initializedRevision = consent.revision
  })().finally(() => {
    initPromise = null
    if (desiredRevision && desiredRevision !== consent.revision) {
      void refreshTelemetryConsent()
        .then((latest) => initializeForConsent(latest.enabled ? latest : null))
        .catch(() => {})
    }
  })
  await initPromise
}

if (env.VITE_PUBLIC_SENTRY_DSN) {
  void refreshTelemetryConsent()
    .then((consent) => initializeForConsent(consent.enabled ? consent : null))
    .catch(() => {})
  subscribeTelemetryConsent((consent) => {
    desiredRevision = consent?.enabled ? consent.revision : null
    if (!consent) {
      for (const controller of inFlight) controller.abort()
      inFlight.clear()
      initializedRevision = null
      void Sentry.close(0).catch(() => {})
      return
    }
    void initializeForConsent(consent)
  })
}

/** @public */
export const sentry = Sentry
