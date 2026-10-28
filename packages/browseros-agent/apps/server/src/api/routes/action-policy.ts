import { Hono } from 'hono'
import {
  ACTION_POLICY_CATALOG,
  DbActionPolicyStore,
  isActionPolicyId,
  validateActionPolicyInput,
} from '../../agent/action-policy'
import type { Env } from '../types'

export function createActionPolicyRoutes(
  store: Pick<
    DbActionPolicyStore,
    'list' | 'put' | 'delete'
  > = new DbActionPolicyStore(),
) {
  return new Hono<Env>()
    .get('/', async (c) => c.json({ actions: await store.list() }))
    .put('/:id', async (c) => {
      const id = c.req.param('id')
      if (!isActionPolicyId(id))
        return c.json({ error: 'Unknown action ID' }, 404)
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'Invalid policy input' }, 400)
      }
      const input = validateActionPolicyInput(body)
      if (!input) return c.json({ error: 'Invalid policy input' }, 400)
      return c.json({ action: await store.put(id, input) })
    })
    .delete('/:id', async (c) => {
      const id = c.req.param('id')
      if (!isActionPolicyId(id))
        return c.json({ error: 'Unknown action ID' }, 404)
      await store.delete(id)
      return c.json({ success: true as const })
    })
}

export const ACTION_POLICY_IDS = ACTION_POLICY_CATALOG.map(({ id }) => id)
