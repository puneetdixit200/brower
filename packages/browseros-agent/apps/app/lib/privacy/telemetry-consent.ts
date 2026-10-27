import { getAgentServerUrl } from '@/lib/browseros/helpers'

export interface TelemetryConsent {
  enabled: boolean
  revision: string
}

let current: TelemetryConsent | null = null
let generation = 0
const listeners = new Set<
  (consent: TelemetryConsent | null, source?: ConsentChangeSource) => void
>()
let watching = false
let revoked = false
let deniedRevision: string | null = null
let mutationGeneration = 0
let mutationQueue: Promise<void> = Promise.resolve()

export type ConsentChangeSource =
  | 'refresh'
  | 'mutation'
  | 'external-revoke'
  | 'snapshot'

function publish(value: TelemetryConsent | null, source: ConsentChangeSource) {
  current = value
  for (const listener of listeners) listener(value, source)
}

export function subscribeTelemetryConsent(
  listener: (
    consent: TelemetryConsent | null,
    source?: ConsentChangeSource,
  ) => void,
): () => void {
  listeners.add(listener)
  listener(current, 'snapshot')
  if (!watching && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    watching = true
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.telemetryConsent) return
      const value = changes.telemetryConsent.newValue as
        | TelemetryConsent
        | undefined
      if (value?.enabled === false) {
        if (value.revision && value.revision === deniedRevision) return
        mutationGeneration++
        generation++
        revoked = true
        deniedRevision = value.revision ?? current?.revision ?? deniedRevision
        publish(null, 'external-revoke')
      } else if (
        value?.enabled === true &&
        value.revision !== current?.revision
      ) {
        mutationGeneration++
        void refreshTelemetryConsent()
      }
    })
  }
  return () => listeners.delete(listener)
}

/** The in-memory grant controls sends; it may be off while profile consent is on. */
export function hasEffectiveTelemetryConsent(): boolean {
  return Boolean(current?.enabled && !revoked)
}

/** Read canonical state; cached grants never authorize startup telemetry. */
export async function refreshTelemetryConsent(): Promise<TelemetryConsent> {
  const requestGeneration = ++generation
  try {
    const baseUrl = await getAgentServerUrl()
    const response = await fetch(`${baseUrl}/privacy/telemetry/state`, {
      method: 'POST',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok)
      throw new Error(`Consent read failed (${response.status})`)
    const value = (await response.json()) as TelemetryConsent
    if (
      typeof value.enabled !== 'boolean' ||
      typeof value.revision !== 'string'
    )
      throw new Error('Invalid consent state')
    if (requestGeneration === generation) {
      if (value.enabled && revoked) {
        if (deniedRevision && value.revision !== deniedRevision) revoked = false
        else {
          publish(null, 'refresh')
          return value
        }
      }
      publish(value.enabled ? value : null, 'refresh')
      // The cached state is an invalidation hint only; true always triggers a server read.
      void chrome.storage.local.set({ telemetryConsent: value }).catch(() => {})
    }
    return value
  } catch (error) {
    if (requestGeneration === generation) publish(null, 'refresh')
    throw error
  }
}

export async function setTelemetryConsent(
  enabled: boolean,
): Promise<TelemetryConsent> {
  const operation = ++mutationGeneration
  if (!enabled) {
    generation++
    revoked = true
    deniedRevision = current?.revision ?? deniedRevision
    publish(null, 'mutation')
    void chrome.storage.local
      .set({ telemetryConsent: { enabled: false, revision: deniedRevision } })
      .catch(() => {})
  }
  const update = mutationQueue.then(async () => {
    if (operation !== mutationGeneration)
      throw new Error('Consent update was superseded')
    const baseUrl = await getAgentServerUrl()
    const response = await fetch(`${baseUrl}/privacy/telemetry`, {
      method: 'PUT',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ enabled }),
    })
    if (!response.ok)
      throw new Error(`Consent update failed (${response.status})`)
    const value = (await response.json()) as TelemetryConsent
    if (
      typeof value.enabled !== 'boolean' ||
      typeof value.revision !== 'string'
    )
      throw new Error('Invalid consent response')
    if (value.enabled !== enabled)
      throw new Error('Consent service returned a different choice')
    if (operation !== mutationGeneration)
      throw new Error('Consent update was superseded')
    generation++
    if (value.enabled) {
      revoked = false
      deniedRevision = null
    } else {
      revoked = true
      deniedRevision = value.revision
    }
    publish(value.enabled ? value : null, 'mutation')
    await chrome.storage.local.set({ telemetryConsent: value }).catch(() => {})
    // A cross-context revoke can arrive while the storage write is pending.
    // Never let that stale opt-in resolve successfully for the UI.
    if (operation !== mutationGeneration)
      throw new Error('Consent update was superseded')
    if (
      value.enabled &&
      (!current?.enabled || current.revision !== value.revision)
    )
      throw new Error('Consent update was superseded')
    return value
  })
  mutationQueue = update.then(
    () => undefined,
    () => undefined,
  )
  return update
}

/** Re-read server state for every envelope and require the initialization revision. */
export async function hasCurrentTelemetryGrant(
  revision: string,
): Promise<boolean> {
  try {
    const value = await refreshTelemetryConsent()
    return (
      !revoked &&
      value.enabled &&
      value.revision === revision &&
      current?.revision === revision
    )
  } catch {
    return false
  }
}
