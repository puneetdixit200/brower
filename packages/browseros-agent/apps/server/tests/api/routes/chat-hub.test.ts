import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import type { UIMessageChunk } from 'ai'
import type { Hono } from 'hono'
import { SessionStore } from '../../../src/agent/session-store'
import { createChatRoutes } from '../../../src/api/routes/chat'
import { ConversationRuns } from '../../../src/api/services/conversation-runs'
import type { Env } from '../../../src/api/types'
import { getToolOutputDir } from '../../../src/lib/browseros-dir'

const localServer = {
  server: {
    requestIP: () => ({ address: '127.0.0.1' }),
  },
} as never

describe('/chat server-owned run routes', () => {
  it('requires a trusted app origin and a live conversation capability for artifact reads', async () => {
    const conversationId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    const app = route(new ConversationRuns())
    const unauthorized = await app.request(
      `/${conversationId}/artifacts/${artifactId}`,
      { headers: { Host: 'localhost' } },
      localServer,
    )
    expect(unauthorized.status).toBe(403)

    const missing = await requestFromExtension(
      app,
      `/${conversationId}/artifacts/${artifactId}`,
    )
    expect(missing.status).toBe(404)
  })

  it('serves only a verified artifact capability owned by the requested conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chat-artifact-route-'))
    const previousBrowserosDir = process.env.BROWSEROS_DIR
    const previousAsterDir = process.env.ASTER_DIR
    process.env.BROWSEROS_DIR = root
    process.env.ASTER_DIR = root
    try {
      const outputRoot = await getToolOutputDir()
      const path = join(outputRoot, 'artifact.bin')
      const contents = Buffer.from('verified response body')
      await writeFile(path, contents)
      const access = createBrowserOutputFileAccess()
      const artifactId = access.recordArtifact({
        path,
        filename: 'artifact.bin',
        sizeBytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      })
      const conversationId = crypto.randomUUID()
      const otherConversationId = crypto.randomUUID()
      const sessions = new SessionStore()
      sessions.set(conversationId, { outputFileAccess: access } as never)
      const app = route(new ConversationRuns(), sessions)

      const response = await requestFromExtension(
        app,
        `/${conversationId}/artifacts/${artifactId}`,
      )
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(contents)
      expect(response.headers.get('content-disposition')).toContain(
        'artifact.bin',
      )

      const wrongOwner = await requestFromExtension(
        app,
        `/${otherConversationId}/artifacts/${artifactId}`,
      )
      expect(wrongOwner.status).toBe(404)
      sessions.remove(conversationId)
      const afterSessionRemoval = await requestFromExtension(
        app,
        `/${conversationId}/artifacts/${artifactId}`,
      )
      expect(afterSessionRemoval.status).toBe(404)
    } finally {
      if (previousBrowserosDir === undefined) delete process.env.BROWSEROS_DIR
      else process.env.BROWSEROS_DIR = previousBrowserosDir
      if (previousAsterDir === undefined) delete process.env.ASTER_DIR
      else process.env.ASTER_DIR = previousAsterDir
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns persisted interruption metadata from state without exposing a stream', async () => {
    const runId = crypto.randomUUID()
    const lifecycleStore = {
      start: () => {},
      finish: () => {},
      appendTraceEvent: () => {},
      getTraceEvents: () => [],
      ensureInterruptionTraceEvent: (
        _conversationId: string,
        taskId: string,
        at: number,
      ) => ({
        version: 1,
        taskId,
        eventId: crypto.randomUUID(),
        at,
        kind: 'task_interrupted',
      }),
      get: (conversationId: string) => ({
        conversationId,
        runId,
        status: 'interrupted' as const,
        startedAt: 100,
        finishedAt: 200,
        tracePersistenceDegraded: false,
      }),
      markTracePersistenceDegraded: () => {},
    }
    const runs = new ConversationRuns({ lifecycleStore })
    const conversationId = crypto.randomUUID()
    const app = route(runs)
    const state = await requestFromExtension(app, `/${conversationId}/state`)
    expect(state.status).toBe(200)
    expect(await state.json()).toMatchObject({
      conversationId,
      runId,
      status: 'interrupted',
      chunkCount: 0,
      startedAt: 100,
      finishedAt: 200,
    })
    expect(
      (await requestFromExtension(app, `/${conversationId}/stream`)).status,
    ).toBe(204)
  })

  it('serves canonical state and a reconnect stream from the same hub', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    let source!: ReadableStreamDefaultController<UIMessageChunk>
    await runs.start({
      conversationId,
      messages: [{ id: 'user-1', role: 'user', parts: [] }],
      createStream: () =>
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            source = controller
          },
        }),
    })
    const app = route(runs)

    const stateResponse = await requestFromExtension(
      app,
      `/${conversationId}/state`,
      { headers: { Referer: 'chrome-extension://assistant/app.html' } },
    )
    expect(stateResponse.status).toBe(200)
    expect(await stateResponse.json()).toMatchObject({
      conversationId,
      status: 'running',
      messages: [{ id: 'user-1' }],
    })

    const streamResponse = await requestFromExtension(
      app,
      `/${conversationId}/stream`,
    )
    expect(streamResponse.headers.get('content-type')).toContain(
      'text/event-stream',
    )
    const text = streamResponse.text()
    source.enqueue({ type: 'text-start', id: 'answer-1' })
    source.close()
    expect(await text).toContain('"type":"text-start"')
  })

  it('rejects a stream request for a superseded run and removes closed-tab bindings', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    await runs.start({
      conversationId,
      messages: [],
      panelTabIds: [42],
      createStream: () => new ReadableStream<UIMessageChunk>(),
    })
    const app = route(runs)
    const response = await requestFromExtension(
      app,
      `/${conversationId}/stream?runId=old`,
    )
    expect(response.status).toBe(409)
    const removed = await requestFromExtension(app, '/panels/42', {
      method: 'DELETE',
    })
    expect(removed.status).toBe(200)
    const assignments = runs.subscribePanelAssignments().getReader()
    expect((await assignments.read()).value?.assignments).toEqual([])
    await assignments.cancel()
    await runs.stop(conversationId)
  })

  it('replays a run that finishes between state hydration and reconnect', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    let source!: ReadableStreamDefaultController<UIMessageChunk>
    await runs.start({
      conversationId,
      messages: [{ id: 'user-1', role: 'user', parts: [] }],
      createStream: () =>
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            source = controller
          },
        }),
    })
    source.enqueue({ type: 'text-start', id: 'answer-1' })
    source.close()
    await eventually(() =>
      expect(runs.getSnapshot(conversationId)?.status).toBe('completed'),
    )

    const response = await requestFromExtension(
      route(runs),
      `/${conversationId}/stream`,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('"type":"text-start"')
  })

  it('streams complete panel assignments to the extension over SSE', async () => {
    const runs = new ConversationRuns()
    await runs.start({
      conversationId: crypto.randomUUID(),
      messages: [],
      panelTabIds: [42],
      createStream: () => new ReadableStream<UIMessageChunk>(),
    })

    const response = await requestFromExtension(route(runs), '/panels')
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    const first = await reader?.read()
    const text = new TextDecoder().decode(first?.value)
    expect(text).toContain('"assignments"')
    expect(text).toContain('"tabId":42')
    await reader?.cancel()
  })

  it('cancels a run through the explicit stop endpoint', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    await runs.start({
      conversationId,
      messages: [],
      createStream: () => new ReadableStream<UIMessageChunk>(),
    })

    const response = await requestFromExtension(
      route(runs),
      `/${conversationId}/stop`,
      {
        method: 'POST',
      },
    )

    expect(await response.json()).toEqual({ stopped: true })
    expect(runs.getSnapshot(conversationId)?.status).toBe('aborted')
  })

  it('rejects originless conversation reads and stop requests', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    await runs.start({
      conversationId,
      messages: [],
      createStream: () => new ReadableStream<UIMessageChunk>(),
    })
    const app = route(runs)

    for (const path of [
      `/${conversationId}/state`,
      `/${conversationId}/stream`,
    ]) {
      const response = await app.request(path, {}, localServer)
      expect(response.status).toBe(403)
    }
    const stop = await app.request(
      `/${conversationId}/stop`,
      {
        method: 'POST',
        headers: { Host: 'localhost', 'Sec-Fetch-Site': 'none' },
      },
      localServer,
    )
    expect(stop.status).toBe(403)
    expect(runs.getSnapshot(conversationId)?.status).toBe('running')
    await runs.stop(conversationId)
  })

  it('allows actual headerless extension GET metadata for state only', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    await runs.start({
      conversationId,
      messages: [],
      createStream: () => new ReadableStream<UIMessageChunk>(),
    })
    const app = route(runs)
    const state = await app.request(
      `/${conversationId}/state`,
      {
        headers: { Host: 'localhost', 'Sec-Fetch-Site': 'none' },
      },
      localServer,
    )
    expect(state.status).toBe(200)

    const stream = await app.request(
      `/${conversationId}/stream`,
      {
        headers: { Host: 'localhost', 'Sec-Fetch-Site': 'none' },
      },
      localServer,
    )
    const panels = await app.request(
      '/panels',
      {
        headers: { Host: 'localhost', 'Sec-Fetch-Site': 'none' },
      },
      localServer,
    )
    const post = await app.request(
      '/',
      {
        method: 'POST',
        headers: { Host: 'localhost', 'Sec-Fetch-Site': 'none' },
      },
      localServer,
    )
    expect(stream.status).toBe(403)
    expect(panels.status).toBe(403)
    expect(post.status).toBe(403)
    await runs.stop(conversationId)
  })

  it('rejects remote Origin and Referer metadata on state reads', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    await runs.start({
      conversationId,
      messages: [],
      createStream: () => new ReadableStream<UIMessageChunk>(),
    })
    const app = route(runs)
    const remoteOrigin = await app.request(
      `/${conversationId}/state`,
      {
        headers: {
          Host: 'localhost',
          Origin: 'https://example.com',
          Referer: 'https://example.com/page',
          'Sec-Fetch-Site': 'cross-site',
        },
      },
      localServer,
    )
    const remoteReferer = await app.request(
      `/${conversationId}/state`,
      {
        headers: {
          Host: 'localhost',
          Referer: 'https://example.com/page',
          'Sec-Fetch-Site': 'none',
        },
      },
      localServer,
    )
    expect(remoteOrigin.status).toBe(403)
    expect(remoteReferer.status).toBe(403)
    await runs.stop(conversationId)
  })
})

function route(runs: ConversationRuns, sessionStore?: SessionStore) {
  return createChatRoutes({
    browser: {} as never,
    browserMcp: {} as never,
    serverPort: 9000,
    conversationRuns: runs,
    sessionStore,
  })
}

function requestFromExtension(
  app: Hono<Env>,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  headers.set('Host', 'localhost')
  headers.set('Origin', 'chrome-extension://assistant')
  return app.request(path, { ...init, headers }, localServer)
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch {
      await Promise.resolve()
    }
  }
  assertion()
}
