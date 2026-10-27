import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createMemoryRoutes } from '../../../src/api/routes/memory'
import type { Env } from '../../../src/api/types'
import { requireTrustedAppOrigin } from '../../../src/api/utils/request-auth'
import { closeDb, initializeDb } from '../../../src/lib/db'

const localServer = {
  server: {
    requestIP: () => ({ address: '127.0.0.1' }),
  },
} as never

describe('memory API', () => {
  const dirs: string[] = []

  afterEach(async () => {
    closeDb()
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    dirs.length = 0
  })

  test('requires a trusted local origin and supports note retrieval and deletion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aster-memory-route-'))
    dirs.push(dir)
    initializeDb({ dbPath: join(dir, 'aster.sqlite') })

    const app = new Hono<Env>()
      .use('/memory', requireTrustedAppOrigin())
      .use('/memory/*', requireTrustedAppOrigin())
      .route('/memory', createMemoryRoutes())

    const blocked = await app.request(
      'http://localhost/memory',
      { method: 'POST', body: '{}' },
      localServer,
    )
    expect(blocked.status).toBe(403)

    const origin = {
      Host: 'localhost',
      Origin: 'chrome-extension://aster-test',
    }
    const enabled = await app.request(
      'http://localhost/memory/settings',
      {
        method: 'PUT',
        headers: { ...origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, retentionDays: 90 }),
      },
      localServer,
    )
    expect(enabled.status).toBe(200)

    const savedResponse = await app.request(
      'http://localhost/memory',
      {
        method: 'POST',
        headers: { ...origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Save the local API provenance note' }),
      },
      localServer,
    )
    expect(savedResponse.status).toBe(201)
    const { memory } = (await savedResponse.json()) as {
      memory: { id: string }
    }

    const resultsResponse = await app.request(
      'http://localhost/memory/search',
      {
        method: 'POST',
        headers: { ...origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'API provenance' }),
      },
      localServer,
    )
    expect(resultsResponse.status).toBe(200)
    expect((await resultsResponse.json()).memories).toHaveLength(1)

    const deleted = await app.request(
      `http://localhost/memory/${memory.id}`,
      { method: 'DELETE', headers: origin },
      localServer,
    )
    expect(deleted.status).toBe(200)
    expect(
      (
        await app.request(
          'http://localhost/memory',
          { headers: origin },
          localServer,
        )
      ).status,
    ).toBe(200)
  })
})
