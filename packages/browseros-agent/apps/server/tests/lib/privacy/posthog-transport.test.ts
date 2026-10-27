/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { expect, test } from 'bun:test'
import { PostHog } from 'posthog-node'
import {
  discardPostHogQueue,
  PostHogTransportLease,
} from '../../../src/lib/privacy/posthog-transport'

const HOST = 'https://posthog.example.invalid'

test('revoked PostHog lease blocks all later SDK sends, including after re-opt-in', async () => {
  const firstNetworkCalls: string[] = []
  const firstLease = new PostHogTransportLease(HOST, async (url) => {
    firstNetworkCalls.push(url)
    return new Response('ok', { status: 200 })
  })
  const client = new PostHog('test-key', {
    host: HOST,
    fetch: firstLease.fetch,
    flushAt: 20,
    flushInterval: 60_000,
    preloadFeatureFlags: false,
    disableRemoteConfig: true,
    enableExceptionAutocapture: false,
  })

  client.capture({ distinctId: 'install-a', event: 'accepted-event' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  const queue = client as unknown as {
    getPersistedProperty: (key: string) => unknown[] | undefined
  }
  expect(queue.getPersistedProperty('queue')).toHaveLength(1)

  firstLease.revoke()
  discardPostHogQueue(client)
  expect(queue.getPersistedProperty('queue')).toBeUndefined()
  expect(firstLease.isValid()).toBe(false)

  // A stale client cannot revive its lease or emit events after consent returns.
  client.capture({ distinctId: 'install-a', event: 'stale-event' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await client.flush()
  expect(firstNetworkCalls).toEqual([])
  discardPostHogQueue(client)
  await client.shutdown(100).catch(() => undefined)

  // A fresh opt-in gets an independent lease and client.
  const secondNetworkCalls: string[] = []
  const secondLease = new PostHogTransportLease(HOST, async (url) => {
    secondNetworkCalls.push(url)
    return new Response('ok', { status: 200 })
  })
  const nextClient = new PostHog('test-key', {
    host: HOST,
    fetch: secondLease.fetch,
    flushAt: 20,
    flushInterval: 60_000,
    preloadFeatureFlags: false,
    disableRemoteConfig: true,
    enableExceptionAutocapture: false,
  })
  nextClient.capture({ distinctId: 'install-a', event: 'new-consent-event' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await nextClient.flush()
  expect(secondNetworkCalls).toEqual([`${HOST}/batch/`])
  discardPostHogQueue(nextClient)
  await nextClient.shutdown(100).catch(() => undefined)
})

test('revocation aborts requests already in progress and rejects unapproved hosts', async () => {
  let markStarted: (() => void) | undefined
  let observedSignal: AbortSignal | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const lease = new PostHogTransportLease(HOST, async (_url, options) => {
    observedSignal = options.signal as AbortSignal | undefined
    markStarted?.()
    return await new Promise<Response>((_resolve, reject) => {
      observedSignal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    })
  })

  const request = lease.fetch(`${HOST}/batch/`, {
    method: 'POST',
    headers: {},
    body: '{}',
  })
  await started
  lease.revoke()
  expect(observedSignal?.aborted).toBe(true)
  await expect(request).rejects.toThrow()

  const blocked = await lease.fetch('https://attacker.invalid/batch/', {
    method: 'POST',
    headers: {},
  })
  expect(blocked.status).toBe(202)
})

test('cross-context revision change permanently invalidates the send lease', async () => {
  let currentRevision = 'grant-1'
  const networkCalls: string[] = []
  const lease = new PostHogTransportLease(
    HOST,
    async (url) => {
      networkCalls.push(url)
      return new Response('ok', { status: 200 })
    },
    async () => currentRevision === 'grant-1',
  )
  const options = { method: 'POST', headers: {}, body: '{}' }
  await lease.fetch(`${HOST}/batch/`, options)
  expect(networkCalls).toHaveLength(1)

  currentRevision = 'revoke-2'
  await lease.fetch(`${HOST}/batch/`, options)
  expect(networkCalls).toHaveLength(1)
  expect(lease.isValid()).toBe(false)
})

test('pinned SDK transport drains revoked queues locally and keeps old clients blocked', async () => {
  const payloads: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      payloads.push(await request.text())
      return new Response('ok', { status: 200 })
    },
  })
  const host = `http://127.0.0.1:${server.port}`
  const makeClient = (lease: PostHogTransportLease) =>
    new PostHog('phc_local_test_only', {
      host,
      fetch: lease.fetch,
      flushAt: 20,
      flushInterval: 60_000,
      preloadFeatureFlags: false,
      disableRemoteConfig: true,
      enableExceptionAutocapture: false,
    })

  const oldLease = new PostHogTransportLease(host)
  const oldClient = makeClient(oldLease)
  try {
    oldClient.capture({
      distinctId: 'install-test',
      event: 'browseros.server.chat.request',
      properties: { install_id: 'install-test', product: 'browseros' },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await oldClient.flush()
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toContain('browseros.server.chat.request')
    expect(payloads[0]).not.toContain('PROMPT_SENTINEL')

    oldClient.capture({
      distinctId: 'install-test',
      event: 'queued-before-revoke',
      properties: {},
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    oldLease.revoke()
    discardPostHogQueue(oldClient)
    await oldClient.shutdown(100)
    expect(payloads).toHaveLength(1)

    const newLease = new PostHogTransportLease(host)
    const newClient = makeClient(newLease)
    newClient.capture({
      distinctId: 'install-test',
      event: 'new-grant',
      properties: {},
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await newClient.flush()
    expect(payloads).toHaveLength(2)

    oldClient.capture({
      distinctId: 'install-test',
      event: 'old-after-regrant',
      properties: {},
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await oldClient.flush()
    expect(payloads).toHaveLength(2)
    discardPostHogQueue(newClient)
    await newClient.shutdown(100)
  } finally {
    oldLease.revoke()
    server.stop(true)
  }
})
