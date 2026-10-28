import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { dbMemoryStore } from '../../lib/memory/memory-store'
import { siteRecipeStore } from '../../lib/memory/site-recipe-store'
import type { Env } from '../types'

const Id = z.object({ recipeId: z.string().uuid() })
const Data = z.object({
  origin: z.string().url().max(2048),
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(6000),
})
const Verify = z.object({ origin: z.string().url().max(2048) })

/** A manual, opt-in local recipe editor. No unattended recipe execution. */
export function createSiteRecipeRoutes() {
  return new Hono<Env>()
    .use('*', async (c, next) => {
      if (c.req.header('X-Aster-Incognito') === 'true') {
        return c.json({ error: 'Recipes unavailable in incognito' }, 403)
      }
      if (!dbMemoryStore.settings().enabled) {
        return c.json({ error: 'Enable memory before using site recipes' }, 403)
      }
      return next()
    })
    .get('/', (c) => c.json({ recipes: siteRecipeStore.list() }))
    .post('/', zValidator('json', Data), (c) => {
      try {
        return c.json({ recipe: siteRecipeStore.save(c.req.valid('json')) }, 201)
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid recipe' }, 400)
      }
    })
    .put('/:recipeId',
      zValidator('param', Id),
      zValidator('json', Data),
      (c) => {
        try {
          return c.json({ recipe: siteRecipeStore.save({
            ...c.req.valid('json'),
            id: c.req.valid('param').recipeId,
          }) })
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : 'Invalid recipe' }, 400)
        }
      },
    )
    .post('/:recipeId/verify',
      zValidator('param', Id),
      zValidator('json', Verify),
      (c) => {
        try {
          return c.json({ recipe: siteRecipeStore.verify(
            c.req.valid('param').recipeId, c.req.valid('json').origin,
          ) })
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : 'Invalid origin' }, 400)
        }
      },
    )
    .delete('/:recipeId', zValidator('param', Id), (c) => {
      return siteRecipeStore.delete(c.req.valid('param').recipeId)
        ? c.json({ success: true })
        : c.json({ error: 'Recipe not found' }, 404)
    })
}
