/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { expect, mock, test } from 'bun:test'
import { createPrivacyRoutes } from '../../../src/api/routes/privacy'
import { resetAllowedOriginsForTesting } from '../../../src/api/utils/cors'

const TRUSTED_ORIGIN = 'chrome-extension://oifdmombnijnaiocijiacjhajbnpdlhb'
const localServer = {
  server: {
    requestIP: () => ({ address: '127.0.0.1' }),
  },
} as never

test('telemetry consent read is POST-only, bodyless, explicit-origin and loopback', async () => {
  resetAllowedOriginsForTesting()
  let enabled = false
  const readConsent = mock(() => ({ enabled, revision: 'revision-1' }))
  const app = createPrivacyRoutes({
    readConsent,
    setConsent: async (value) => {
      enabled = value
      return { enabled, revision: 'revision-2' }
    },
    applyConsent: () => {},
  })

  const accepted = await app.request(
    '/telemetry/state',
    {
      method: 'POST',
      headers: { Host: 'localhost', Origin: TRUSTED_ORIGIN },
    },
    localServer,
  )
  expect(accepted.status).toBe(200)
  await expect(accepted.json()).resolves.toEqual({
    enabled: false,
    revision: 'revision-1',
  })
  expect(readConsent).toHaveBeenCalledTimes(1)

  const originless = await app.request(
    '/telemetry/state',
    { method: 'POST', headers: { Host: 'localhost' } },
    localServer,
  )
  expect(originless.status).toBe(403)

  const untrusted = await app.request(
    '/telemetry/state',
    {
      method: 'POST',
      headers: { Host: 'localhost', Origin: 'https://attacker.invalid' },
    },
    localServer,
  )
  expect(untrusted.status).toBe(403)

  const nonLoopback = await app.request(
    '/telemetry/state',
    {
      method: 'POST',
      headers: { Host: 'localhost', Origin: TRUSTED_ORIGIN },
    },
    { server: { requestIP: () => ({ address: '192.0.2.50' }) } } as never,
  )
  expect(nonLoopback.status).toBe(403)

  const withBody = await app.request(
    '/telemetry/state',
    {
      method: 'POST',
      headers: {
        Host: 'localhost',
        Origin: TRUSTED_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    localServer,
  )
  expect(withBody.status).toBe(400)
})

test('telemetry consent write validates strict JSON and returns persisted state', async () => {
  resetAllowedOriginsForTesting()
  let enabled = false
  const setConsent = mock(async (value: boolean) => {
    enabled = value
    return { enabled, revision: 'revision-2' }
  })
  const app = createPrivacyRoutes({
    readConsent: () => ({ enabled, revision: 'revision-1' }),
    setConsent,
    applyConsent: () => {},
  })
  const request = (body: string, contentType = 'application/json') =>
    app.request(
      '/telemetry',
      {
        method: 'PUT',
        headers: {
          Host: 'localhost',
          Origin: TRUSTED_ORIGIN,
          'Content-Type': contentType,
        },
        body,
      },
      localServer,
    )

  const accepted = await request('{"enabled":true}')
  expect(accepted.status).toBe(200)
  await expect(accepted.json()).resolves.toEqual({
    enabled: true,
    revision: 'revision-2',
  })
  expect(setConsent).toHaveBeenCalledWith(true)

  const invalidType = await request('{"enabled":"true"}')
  expect(invalidType.status).toBe(400)
  const extraField = await request('{"enabled":false,"data":"leak"}')
  expect(extraField.status).toBe(400)
  const invalidJson = await request('{')
  expect(invalidJson.status).toBe(400)
  const wrongContentType = await request('{"enabled":false}', 'text/plain')
  expect(wrongContentType.status).toBe(415)
  expect(setConsent).toHaveBeenCalledTimes(1)

  const rejectedWrite = await app.request(
    '/telemetry',
    {
      method: 'PUT',
      headers: {
        Host: 'localhost',
        Origin: 'https://attacker.invalid',
        'Content-Type': 'application/json',
      },
      body: '{"enabled":false}',
    },
    localServer,
  )
  expect(rejectedWrite.status).toBe(403)
  expect(enabled).toBe(true)
})

test('concurrent consent writes apply in order and renew the grant revision', async () => {
  resetAllowedOriginsForTesting()
  let enabled = false
  let revision = 0
  const applied: Array<{ enabled: boolean; revision: string }> = []
  const app = createPrivacyRoutes({
    readConsent: () => ({ enabled, revision: `revision-${revision}` }),
    setConsent: async (value) => {
      enabled = value
      revision += 1
      return { enabled, revision: `revision-${revision}` }
    },
    applyConsent: (state) => {
      applied.push(state)
    },
  })
  const request = (value: boolean) =>
    app.request(
      '/telemetry',
      {
        method: 'PUT',
        headers: {
          Host: 'localhost',
          Origin: TRUSTED_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: value }),
      },
      localServer,
    )

  const [grant, renewed, revoke] = await Promise.all([
    request(true),
    request(true),
    request(false),
  ])
  expect(grant.status).toBe(200)
  expect(renewed.status).toBe(200)
  expect(revoke.status).toBe(200)
  expect(applied.map(({ enabled }) => enabled)).toEqual([true, true, false])
  expect(new Set(applied.map(({ revision }) => revision)).size).toBe(3)
  expect(enabled).toBe(false)
})
