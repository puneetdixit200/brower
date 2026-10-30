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

  test('rejects incognito requests on every route before accessing the store', async () => {
    const calls: string[] = []
    const store = Object.fromEntries(
      [
        'list',
        'updateSettings',
        'settings',
        'search',
        'history',
        'undo',
        'save',
        'remove',
      ].map((method) => [
        method,
        () => {
          calls.push(method)
          throw new Error(`memory store ${method} must not run in incognito`)
        },
      ]),
    )
    const app = new Hono<Env>()
      .use('/memory', requireTrustedAppOrigin())
      .use('/memory/*', requireTrustedAppOrigin())
      .route('/memory', createMemoryRoutes({ store: store as never }))
    const memoryId = crypto.randomUUID()
    const headers = {
      Host: 'localhost',
      Origin: 'chrome-extension://aster-test',
      'X-Aster-Incognito': 'true',
    }
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }
    const json = (body: unknown) => JSON.stringify(body)
    const taskNote = {
      content: 'private',
      sourceId: memoryId,
      sourceTitle: 'private task',
    }
    const requests: Array<[string, RequestInit]> = [
      ['/memory', { headers }],
      [
        '/memory/settings',
        {
          method: 'PUT',
          headers: jsonHeaders,
          body: json({ enabled: true, retentionDays: 90 }),
        },
      ],
      [
        '/memory/search',
        {
          method: 'POST',
          headers: jsonHeaders,
          body: json({ query: 'private' }),
        },
      ],
      [`/memory/${memoryId}/revisions`, { headers }],
      [`/memory/${memoryId}/undo`, { method: 'POST', headers }],
      [
        '/memory',
        {
          method: 'POST',
          headers: jsonHeaders,
          body: json(taskNote),
        },
      ],
      [
        `/memory/${memoryId}`,
        {
          method: 'PUT',
          headers: jsonHeaders,
          body: json(taskNote),
        },
      ],
      [`/memory/${memoryId}`, { method: 'DELETE', headers }],
    ]

    for (const [path, init] of requests) {
      const response = await app.request(
        `http://localhost${path}`,
        init,
        localServer,
      )
      expect(response.status).toBe(403)
    }
    expect(calls).toEqual([])
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
    const incognitoSave = await app.request(
      'http://localhost/memory',
      {
        method: 'POST',
        headers: {
          ...origin,
          'Content-Type': 'application/json',
          'X-Aster-Incognito': 'true',
        },
        body: JSON.stringify({ content: 'Must not persist from incognito' }),
      },
      localServer,
    )
    expect(incognitoSave.status).toBe(403)

    const taskProvenance = {
      content: 'The deployment uses the stable release branch.',
      sourceId: crypto.randomUUID(),
      sourceTitle: 'Check the project deployment branch',
    }
    const disabledTaskSave = await app.request(
      'http://localhost/memory',
      {
        method: 'POST',
        headers: { ...origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(taskProvenance),
      },
      localServer,
    )
    expect(disabledTaskSave.status).toBe(403)

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

    const taskSaved = await app.request(
      'http://localhost/memory',
      {
        method: 'POST',
        headers: { ...origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(taskProvenance),
      },
      localServer,
    )
    expect(taskSaved.status).toBe(201)
    const taskMemory = (await taskSaved.json()).memory
    expect(taskMemory.source).toBe('task')
    expect(taskMemory.sourceId).toBe(taskProvenance.sourceId)
    expect(taskMemory.sourceTitle).toBe(taskProvenance.sourceTitle)

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
    const editedResponse = await app.request(
      `http://localhost/memory/${memory.id}`,
      {
        method: 'PUT',
        headers: { ...origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Changed local route history detail' }),
      },
      localServer,
    )
    expect(editedResponse.status).toBe(200)

    const blockedHistory = await app.request(
      `http://localhost/memory/${memory.id}/revisions`,
      {},
      localServer,
    )
    expect(blockedHistory.status).toBe(403)
    const privateHistory = await app.request(
      `http://localhost/memory/${memory.id}/revisions`,
      { headers: { ...origin, 'X-Aster-Incognito': 'true' } },
      localServer,
    )
    expect(privateHistory.status).toBe(403)
    const malformedId = await app.request(
      'http://localhost/memory/not-a-uuid/revisions',
      { headers: origin },
      localServer,
    )
    expect(malformedId.status).toBe(400)
    const historyResponse = await app.request(
      `http://localhost/memory/${memory.id}/revisions`,
      { headers: origin },
      localServer,
    )
    expect(historyResponse.status).toBe(200)
    expect(
      (await historyResponse.json()).revisions.map(
        (row: { content: string }) => row.content,
      ),
    ).toEqual(['Save the local API provenance note'])

    const blockedUndo = await app.request(
      `http://localhost/memory/${memory.id}/undo`,
      { method: 'POST' },
      localServer,
    )
    expect(blockedUndo.status).toBe(403)
    const privateUndo = await app.request(
      `http://localhost/memory/${memory.id}/undo`,
      {
        method: 'POST',
        headers: { ...origin, 'X-Aster-Incognito': 'true' },
      },
      localServer,
    )
    expect(privateUndo.status).toBe(403)

    const undoResponse = await app.request(
      `http://localhost/memory/${memory.id}/undo`,
      { method: 'POST', headers: origin },
      localServer,
    )
    expect(undoResponse.status).toBe(200)
    expect((await undoResponse.json()).memory.content).toBe(
      'Save the local API provenance note',
    )
    const undoAgain = await app.request(
      `http://localhost/memory/${memory.id}/undo`,
      { method: 'POST', headers: origin },
      localServer,
    )
    expect(undoAgain.status).toBe(404)

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
    const deletedHistory = await app.request(
      `http://localhost/memory/${memory.id}/revisions`,
      { headers: origin },
      localServer,
    )
    expect((await deletedHistory.json()).revisions).toEqual([])
    const undoDeleted = await app.request(
      `http://localhost/memory/${memory.id}/undo`,
      { method: 'POST', headers: origin },
      localServer,
    )
    expect(undoDeleted.status).toBe(404)
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
