/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createContentFreeTelemetryEvent } from '@browseros/shared/sentry/telemetry-event'
import type { BunOptions } from '@sentry/bun'

type SentryTransportFactory = NonNullable<BunOptions['transport']>
type SentryTransport =
  ReturnType<SentryTransportFactory> extends infer T ? NonNullable<T> : never
type SentryTransportResponse = Awaited<ReturnType<SentryTransport['send']>>
type TransportOptions = Parameters<SentryTransportFactory>[0]

/**
 * Direct, unbuffered Sentry transport with an irreversible consent lease.
 * `send` dispatches only while the lease is valid; `flush` has no queue to
 * drain. Revocation aborts active fetches and permanently closes this lease.
 */
export class SentryTransportLease {
  private valid = true
  private readonly activeRequests = new Set<AbortController>()

  constructor(
    private readonly approvedOrigin: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly stillAuthorized: () => Promise<boolean> = async () => true,
  ) {}

  isValid(): boolean {
    return this.valid
  }

  revoke(): void {
    if (!this.valid) return
    this.valid = false
    for (const controller of this.activeRequests) controller.abort()
    this.activeRequests.clear()
  }

  async send(
    options: TransportOptions,
    envelope: unknown,
  ): Promise<SentryTransportResponse> {
    const body = serializeContentFreeEnvelope(envelope)
    if (!body || !this.valid || !this.isApprovedUrl(options.url)) {
      return { statusCode: 200 }
    }
    if (!(await this.stillAuthorized())) {
      this.revoke()
      return { statusCode: 200 }
    }

    const controller = new AbortController()
    this.activeRequests.add(controller)
    try {
      // No await occurs between this check and initiating fetch. Revoke aborts
      // the controller if a request is already in flight.
      if (!this.valid) return { statusCode: 200 }
      const response = await this.fetcher(options.url, {
        method: 'POST',
        headers: options.headers,
        body,
        signal: controller.signal,
        redirect: 'error',
      })
      return {
        statusCode: response.status,
        headers: {
          'x-sentry-rate-limits': response.headers.get('X-Sentry-Rate-Limits'),
          'retry-after': response.headers.get('Retry-After'),
        },
      }
    } finally {
      this.activeRequests.delete(controller)
    }
  }

  private isApprovedUrl(value: string): boolean {
    try {
      return new URL(value).origin === new URL(this.approvedOrigin).origin
    } catch {
      return false
    }
  }
}

/** Create a Sentry transport with no event buffer or retry queue. */
export function createSentryTransport(
  lease: SentryTransportLease,
): SentryTransportFactory {
  return (options) => ({
    send: (envelope) => lease.send(options, envelope),
    flush: async () => true,
  })
}

/**
 * Only error envelopes with an exception are sent. Rebuild each event through
 * the shared content-free allowlist so unexpected item/header fields never
 * cross the network boundary.
 */
function serializeContentFreeEnvelope(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [headers, items] = value
  if (!isRecord(headers) || !Array.isArray(items) || items.length === 0) {
    return null
  }

  const safeHeaders: Record<string, unknown> = {}
  if (
    typeof headers.event_id === 'string' &&
    /^[0-9a-f-]{16,64}$/i.test(headers.event_id)
  ) {
    safeHeaders.event_id = headers.event_id
  }
  if (
    typeof headers.sent_at === 'string' &&
    /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/.test(headers.sent_at)
  ) {
    safeHeaders.sent_at = headers.sent_at
  }

  const serializedItems: string[] = []
  for (const item of items) {
    if (!Array.isArray(item) || item.length !== 2) return null
    const [itemHeaders, payload] = item
    if (!isRecord(itemHeaders) || itemHeaders.type !== 'event') return null
    const safeEvent = createContentFreeTelemetryEvent(payload)
    if (!isRecord(safeEvent.exception)) return null
    serializedItems.push(
      `${JSON.stringify({ type: 'event' })}\n${JSON.stringify(safeEvent)}`,
    )
  }

  return `${JSON.stringify(safeHeaders)}\n${serializedItems.join('\n')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
