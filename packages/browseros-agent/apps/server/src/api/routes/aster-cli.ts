import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type { Env } from '../types'
import type { ConversationRuns } from '../services/conversation-runs'

function allowedToken(expected: string, received: string | undefined): boolean {
  if (!expected || !received?.startsWith('Bearer ')) return false
  const given = Buffer.from(received.slice('Bearer '.length), 'utf8')
  const actual = Buffer.from(expected, 'utf8')
  return given.length === actual.length && timingSafeEqual(given, actual)
}

/** Status/stop only; no model execution or transcript exposure via CLI. */
export function createAsterCliRoutes(input: {
  runs: ConversationRuns
  token: string
}) {
  return new Hono<Env>()
    .use('*', async (c, next) => {
      if (!allowedToken(input.token, c.req.header('Authorization'))) {
        return c.json({ error: 'Unauthorized or CLI disabled' }, 401)
      }
      return next()
    })
    .get('/task/:id', (c) => {
      const id = c.req.param('id')
      if (!id || id.length > 180) return c.json({ error: 'Invalid ID' }, 400)
      const snapshot = input.runs.getSnapshot(id)
      if (!snapshot) return c.json({ error: 'Task not found' }, 404)
      return c.json({
        conversationId: snapshot.conversationId,
        runId: snapshot.runId,
        status: snapshot.status,
        chunkCount: snapshot.chunkCount,
      })
    })
    .post('/task/:id/stop', async (c) => {
      const id = c.req.param('id')
      if (!id || id.length > 180) return c.json({ error: 'Invalid ID' }, 400)
      const stopped = await input.runs.stop(id)
      return c.json({ stopped })
    })
}
