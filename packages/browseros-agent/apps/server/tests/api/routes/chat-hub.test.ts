import { describe, expect, it } from 'bun:test'
import type { UIMessageChunk } from 'ai'
import type { Hono } from 'hono'
import { createChatRoutes } from '../../../src/api/routes/chat'
import { ConversationRuns } from '../../../src/api/services/conversation-runs'
import type { Env } from '../../../src/api/types'

const localServer = {
  server: {
    requestIP: () => ({ address: '127.0.0.1' }),
  },
} as never

describe('/chat server-owned run routes', () => {
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
      { method: 'POST' },
      localServer,
    )
    expect(stop.status).toBe(403)
    expect(runs.getSnapshot(conversationId)?.status).toBe('running')
    await runs.stop(conversationId)
  })
})

function route(runs: ConversationRuns) {
  return createChatRoutes({
    browser: {} as never,
    browserMcp: {} as never,
    serverPort: 9000,
    conversationRuns: runs,
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
