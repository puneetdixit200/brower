/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { expect, test } from 'bun:test'
import {
  createSentryTransport,
  SentryTransportLease,
} from '../../../src/lib/privacy/sentry-transport'

const URL = 'https://sentry.example.invalid/api/1/envelope/'

test('direct transport sends only with its active lease and has no queue to flush', async () => {
  const requests: Array<{ url: string; body: string }> = []
  const lease = new SentryTransportLease(
    'https://sentry.example.invalid',
    async (url, init) => {
      requests.push({ url, body: String(init.body) })
      return new Response('', { status: 200 })
    },
  )
  const transport = createSentryTransport(lease)({
    url: URL,
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
  } as never)
  const envelope = [
    { event_id: '0123456789abcdef0123456789abcdef' },
    [
      [
        { type: 'event' },
        {
          event_id: '0123456789abcdef0123456789abcdef',
          message: 'PROMPT_SENTINEL',
          exception: {
            values: [
              {
                type: 'Error',
                value: 'PASSWORD_SENTINEL',
                stacktrace: {
                  frames: [{ filename: '/home/user/private.ts', lineno: 5 }],
                },
              },
            ],
          },
        },
      ],
    ],
  ]

  await transport.send(envelope)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.url).toBe(URL)
  expect(requests[0]?.body).toContain('0123456789abcdef0123456789abcdef')
  expect(requests[0]?.body).not.toContain('PROMPT_SENTINEL')
  expect(requests[0]?.body).not.toContain('PASSWORD_SENTINEL')
  expect(requests[0]?.body).not.toContain('/home/user')

  lease.revoke()
  await transport.send(envelope)
  expect(requests).toHaveLength(1)
  await expect(transport.flush(0)).resolves.toBe(true)
})

test('revocation aborts in-flight requests and a stale lease cannot send again', async () => {
  let markStarted: (() => void) | undefined
  let observedSignal: AbortSignal | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const lease = new SentryTransportLease(
    'https://sentry.example.invalid',
    async (_url, init) => {
      observedSignal = init.signal as AbortSignal
      markStarted?.()
      return await new Promise<Response>((_resolve, reject) => {
        observedSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    },
  )
  const transport = createSentryTransport(lease)({
    url: URL,
    headers: {},
  } as never)
  const envelope = [
    {},
    [
      [
        { type: 'event' },
        {
          exception: { values: [{ type: 'Error', value: 'SECRET_SENTINEL' }] },
        },
      ],
    ],
  ]

  const sending = transport.send(envelope)
  await started
  lease.revoke()
  expect(observedSignal?.aborted).toBe(true)
  await expect(sending).rejects.toThrow()

  const denied = new SentryTransportLease(
    'https://sentry.example.invalid',
    async () => {
      throw new Error('Unapproved host must not fetch')
    },
  )
  const deniedTransport = createSentryTransport(denied)({
    url: 'https://attacker.invalid/api/1/envelope/',
    headers: {},
  } as never)
  await expect(deniedTransport.send(envelope)).resolves.toEqual({
    statusCode: 200,
  })
})

test('cross-context revision change blocks an accepted envelope', async () => {
  let currentRevision = 'grant-1'
  const requests: string[] = []
  const lease = new SentryTransportLease(
    'https://sentry.example.invalid',
    async (url) => {
      requests.push(url)
      return new Response('', { status: 200 })
    },
    async () => currentRevision === 'grant-1',
  )
  const transport = createSentryTransport(lease)({
    url: URL,
    headers: {},
  } as never)
  const envelope = [
    {},
    [[{ type: 'event' }, { exception: { values: [{ type: 'Error' }] } }]],
  ]
  await transport.send(envelope)
  expect(requests).toHaveLength(1)

  currentRevision = 'revoke-2'
  await transport.send(envelope)
  expect(requests).toHaveLength(1)
  expect(lease.isValid()).toBe(false)
})
