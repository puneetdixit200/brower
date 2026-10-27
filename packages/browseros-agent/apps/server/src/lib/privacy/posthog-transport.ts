/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PostHog, PostHogOptions } from 'posthog-node'

type PostHogFetchOptions = Parameters<NonNullable<PostHogOptions['fetch']>>[1]
type PostHogFetchResponse = Awaited<
  ReturnType<NonNullable<PostHogOptions['fetch']>>
>

const DENIED_RESPONSE: PostHogFetchResponse = {
  // The SDK retries 4xx/network failures and can retain queued events. This
  // synthetic success drains the local queue without dispatching it.
  status: 202,
  text: async () => 'Telemetry consent revoked',
  json: async () => ({ error: 'Telemetry consent revoked' }),
}

export type TelemetryFetch = (
  url: string,
  options: PostHogFetchOptions,
) => Promise<PostHogFetchResponse>

/**
 * A permanent per-client transport lease. Once revoked it can never be
 * reactivated, so a later opt-in must create a new client and lease.
 */
export class PostHogTransportLease {
  private valid = true
  private readonly activeRequests = new Set<AbortController>()

  constructor(
    private readonly approvedHost: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly stillAuthorized: () => Promise<boolean> = async () => true,
  ) {}

  readonly fetch: TelemetryFetch = async (url, options) => {
    if (!this.valid || !this.isApprovedUrl(url)) return DENIED_RESPONSE
    if (!(await this.stillAuthorized())) {
      this.revoke()
      return DENIED_RESPONSE
    }

    const controller = new AbortController()
    this.activeRequests.add(controller)
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal
    try {
      // Recheck directly before dispatch in case a prior await is introduced.
      if (!this.valid) return DENIED_RESPONSE
      return await this.fetcher(url, {
        ...options,
        signal,
        redirect: 'error',
      })
    } finally {
      this.activeRequests.delete(controller)
    }
  }

  isValid(): boolean {
    return this.valid
  }

  revoke(): void {
    if (!this.valid) return
    this.valid = false
    for (const controller of this.activeRequests) controller.abort()
    this.activeRequests.clear()
  }

  private isApprovedUrl(value: string): boolean {
    try {
      return new URL(value).origin === new URL(this.approvedHost).origin
    } catch {
      return false
    }
  }
}

/**
 * posthog-node 4.18.0 stores its capture queue in memory under `queue` and
 * exposes its setter as a protected method in TypeScript. The pinned runtime
 * implementation has this method; fail closed if a future SDK removes it.
 */
export function discardPostHogQueue(client: PostHog): void {
  const queueControl = client as unknown as {
    setPersistedProperty?: (key: string, value: unknown) => void
  }
  if (typeof queueControl.setPersistedProperty !== 'function') {
    throw new Error('Pinned PostHog client cannot discard its event queue.')
  }
  queueControl.setPersistedProperty('queue', null)
}
