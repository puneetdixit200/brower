import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createActionPolicyRoutes } from '../../../src/api/routes/action-policy'
import { isTrustedAppOrigin } from '../../../src/api/utils/request-auth'

function makeApp() {
  const rows = new Map<
    string,
    {
      id: string
      label: string
      decision: 'allow' | 'ask' | 'deny'
      expiresAt: number | null
    }
  >()
  const store = {
    list: async () => [...rows.values()],
    put: async (
      id: string,
      input: { decision: 'allow' | 'ask' | 'deny'; expiresAt: number | null },
    ) => {
      const action = { id, label: 'Fixture action', ...input }
      rows.set(id, action)
      return action
    },
    delete: async (id: string) => {
      rows.delete(id)
    },
  }
  const app = new Hono().route(
    '/action-policy',
    createActionPolicyRoutes(store as never),
  )
  const request = (path: string, init?: RequestInit) => app.request(path, init)
  return { app, request }
}

describe('action policy API', () => {
  it('accepts only trusted app origin formats', () => {
    expect(isTrustedAppOrigin('chrome-extension://browseros')).toBe(true)
    expect(isTrustedAppOrigin('http://localhost:3000')).toBe(true)
    expect(isTrustedAppOrigin('https://attacker.example')).toBe(false)
    expect(isTrustedAppOrigin(undefined)).toBe(false)
  })

  it('rejects forged IDs and extra or invalid body fields', async () => {
    const { request } = makeApp()
    const headers = {
      Origin: 'chrome-extension://browseros',
      'Content-Type': 'application/json',
    }
    const forged = await request('/action-policy/not-a-real-id', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ decision: 'allow', expiresAt: null }),
    })
    expect(forged.status).toBe(404)
    const extra = await request('/action-policy/browser.tabs.new', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ decision: 'allow', expiresAt: null, extra: true }),
    })
    expect(extra.status).toBe(400)
    const invalid = await request('/action-policy/browser.tabs.new', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ decision: 'auto', expiresAt: null }),
    })
    expect(invalid.status).toBe(400)
  })

  it('writes and deletes a single action rule', async () => {
    const { request } = makeApp()
    const headers = {
      Origin: 'chrome-extension://browseros',
      'Content-Type': 'application/json',
    }
    const put = await request('/action-policy/browser.tabs.new', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ decision: 'allow', expiresAt: null }),
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({
      action: { id: 'browser.tabs.new', decision: 'allow' },
    })
    const deleted = await request('/action-policy/browser.tabs.new', {
      method: 'DELETE',
      headers,
    })
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ success: true })
  })
})
