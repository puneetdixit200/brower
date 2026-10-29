import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createSiteRecipeRoutes } from '../../../src/api/routes/site-recipes'
import type { Env } from '../../../src/api/types'
import { requireTrustedAppOrigin } from '../../../src/api/utils/request-auth'
import { closeDb, initializeDb } from '../../../src/lib/db'
import { dbMemoryStore } from '../../../src/lib/memory/memory-store'

const localServer = {
  server: {
    requestIP: () => ({ address: '127.0.0.1' }),
  },
} as never

const baseUrl = 'http://localhost/site-recipes'
const origin = {
  Host: 'localhost',
  Origin: 'chrome-extension://aster-test',
}
const validRecipe = {
  title: 'Find a booking',
  origin: 'https://travel.example.org',
  instructions: 'Open the public search form and choose a destination.',
}

describe('site recipes API', () => {
  const dirs: string[] = []
  let app: Hono<Env>

  function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'aster-site-recipes-route-'))
    dirs.push(directory)
    initializeDb({ dbPath: join(directory, 'aster.sqlite') })
    app = new Hono<Env>()
      .use('/site-recipes', requireTrustedAppOrigin())
      .use('/site-recipes/*', requireTrustedAppOrigin())
      .route('/site-recipes', createSiteRecipeRoutes())
  }

  function request(
    path = '',
    init: RequestInit = {},
    headers: Record<string, string> = origin,
  ) {
    return app.request(
      `${baseUrl}${path}`,
      {
        ...init,
        headers: { ...headers, ...init.headers },
      },
      localServer,
    )
  }

  async function enableMemory() {
    dbMemoryStore.updateSettings({ enabled: true, retentionDays: 90 })
  }

  afterEach(async () => {
    closeDb()
    await Promise.all(
      dirs.map((directory) => rm(directory, { recursive: true, force: true })),
    )
    dirs.length = 0
  })

  test('requires trusted origin and enabled memory for every recipe operation', async () => {
    setup()
    expect(
      (await request('', { method: 'GET' }, { Host: 'localhost' })).status,
    ).toBe(403)
    expect(
      (
        await request(
          '',
          { method: 'GET' },
          {
            Host: 'localhost',
            Origin: 'https://untrusted.example',
          },
        )
      ).status,
    ).toBe(403)
    expect((await request('', { method: 'GET' })).status).toBe(403)
    expect(
      (
        await request('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validRecipe),
        })
      ).status,
    ).toBe(403)
    const unavailableRecipeId = crypto.randomUUID()
    expect(
      (
        await request(`/${unavailableRecipeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validRecipe),
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(`/${unavailableRecipeId}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: validRecipe.origin }),
        })
      ).status,
    ).toBe(403)
    expect(
      (await request(`/${unavailableRecipeId}`, { method: 'DELETE' })).status,
    ).toBe(403)

    await enableMemory()
    const list = await request('', { method: 'GET' })
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({ recipes: [] })
    const originlessList = await request(
      '',
      { method: 'GET' },
      { Host: 'localhost' },
    )
    expect(originlessList.status).toBe(200)
    expect(await originlessList.json()).toEqual({ recipes: [] })
    const created = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRecipe),
    })
    expect(created.status).toBe(201)
    const { recipe } = (await created.json()) as { recipe: { id: string } }
    expect(
      (
        await request(
          '',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validRecipe),
          },
          { Host: 'localhost' },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(
          `/${recipe.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validRecipe),
          },
          { Host: 'localhost' },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(`/${recipe.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validRecipe),
        })
      ).status,
    ).toBe(200)
  })

  test('rejects incognito reads, creation, edits, verification, and deletion', async () => {
    setup()
    await enableMemory()
    const created = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRecipe),
    })
    const { recipe } = (await created.json()) as { recipe: { id: string } }
    const privateHeaders = { ...origin, 'X-Aster-Incognito': 'true' }

    expect((await request('', { method: 'GET' }, privateHeaders)).status).toBe(
      403,
    )
    expect(
      (
        await request(
          '',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validRecipe),
          },
          privateHeaders,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(
          `/${recipe.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validRecipe),
          },
          privateHeaders,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(
          `/${recipe.id}/verify`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: validRecipe.origin }),
          },
          privateHeaders,
        )
      ).status,
    ).toBe(403)
    expect(
      (await request(`/${recipe.id}`, { method: 'DELETE' }, privateHeaders))
        .status,
    ).toBe(403)
  })

  test('validates UUIDs and recipe input at the route boundary', async () => {
    setup()
    await enableMemory()
    const malformedId = await request('/not-a-uuid', { method: 'DELETE' })
    expect(malformedId.status).toBe(400)
    const malformedVerifyId = await request('/not-a-uuid/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: validRecipe.origin }),
    })
    expect(malformedVerifyId.status).toBe(400)
    const invalidSchema = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validRecipe, title: '' }),
    })
    expect(invalidSchema.status).toBe(400)
    const invalidOrigin = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validRecipe,
        origin: 'http://travel.example.org',
      }),
    })
    expect(invalidOrigin.status).toBe(400)
    const credentialInstructions = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validRecipe,
        instructions: 'Enter password=do-not-store',
      }),
    })
    expect(credentialInstructions.status).toBe(400)
  })

  test('only matching canonical origin can manually revalidate a recipe', async () => {
    setup()
    await enableMemory()
    const created = await request('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRecipe),
    })
    expect(created.status).toBe(201)
    const { recipe } = (await created.json()) as {
      recipe: { id: string; origin: string; verifiedAt: number | null }
    }
    expect(recipe.verifiedAt).toBeNull()

    const mismatch = await request(`/${recipe.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: 'https://other.example.org' }),
    })
    expect(mismatch.status).toBe(400)
    const afterMismatch = await (await request('', { method: 'GET' })).json()
    expect(afterMismatch).toMatchObject({
      recipes: [{ id: recipe.id, stale: true, verifiedAt: null }],
    })

    const verified = await request(`/${recipe.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: `${recipe.origin}/` }),
    })
    expect(verified.status).toBe(200)
    expect(await verified.json()).toMatchObject({
      recipe: {
        id: recipe.id,
        origin: recipe.origin,
        verifiedAt: expect.any(Number),
      },
    })
    expect(
      (await (await request('', { method: 'GET' })).json()).recipes[0]?.stale,
    ).toBe(false)

    const edited = await request(`/${recipe.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validRecipe, title: 'Updated booking steps' }),
    })
    expect(edited.status).toBe(200)
    expect(
      (await (await request('', { method: 'GET' })).json()).recipes[0]?.stale,
    ).toBe(true)
    const deleted = await request(`/${recipe.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect(
      (await (await request('', { method: 'GET' })).json()).recipes,
    ).toEqual([])
  })
})
