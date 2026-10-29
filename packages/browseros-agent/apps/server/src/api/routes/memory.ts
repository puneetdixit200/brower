/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { dbMemoryStore } from '../../lib/memory/memory-store'
import type { Env } from '../types'

const IdSchema = z.object({ memoryId: z.string().uuid() })
const SaveSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  sourceUrl: z.string().url().max(2_000).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  sourceTitle: z.string().trim().max(300).nullable().optional(),
})
const SettingsSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.union([z.literal(30), z.literal(90), z.null()]),
})
const SearchSchema = z.object({ query: z.string().trim().min(1).max(300) })

export function createMemoryRoutes(
  options: { store?: typeof dbMemoryStore } = {},
) {
  const store = options.store ?? dbMemoryStore
  return new Hono<Env>()
    .use('*', async (c, next) => {
      if (c.req.header('X-Aster-Incognito') === 'true') {
        return c.json(
          { error: 'Aster memory is unavailable in incognito mode' },
          403,
        )
      }
      return next()
    })
    .get('/', (c) => c.json(store.list()))
    .put('/settings', zValidator('json', SettingsSchema), (c) =>
      c.json({ settings: store.updateSettings(c.req.valid('json')) }),
    )
    .post('/search', zValidator('json', SearchSchema), (c) =>
      c.json({ memories: store.search(c.req.valid('json').query) }),
    )
    .get('/:memoryId/revisions', zValidator('param', IdSchema), (c) =>
      c.json({ revisions: store.history(c.req.valid('param').memoryId) }),
    )
    .post('/:memoryId/undo', zValidator('param', IdSchema), (c) => {
      try {
        const memory = store.undo(c.req.valid('param').memoryId)
        return memory
          ? c.json({ memory })
          : c.json({ error: 'No previous note revision is available' }, 404)
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error ? error.message : 'Memory undo failed',
          },
          400,
        )
      }
    })
    .post('/', zValidator('json', SaveSchema), (c) => {
      try {
        const input = c.req.valid('json')
        if (input.sourceId && !store.settings().enabled) {
          return c.json(
            { error: 'Enable memory before saving a task-derived note' },
            403,
          )
        }
        return c.json({ memory: store.save(input) }, 201)
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error ? error.message : 'Memory save failed',
          },
          400,
        )
      }
    })
    .put(
      '/:memoryId',
      zValidator('param', IdSchema),
      zValidator('json', SaveSchema),
      (c) => {
        try {
          const input = c.req.valid('json')
          if (input.sourceId && !store.settings().enabled) {
            return c.json(
              { error: 'Enable memory before saving a task-derived note' },
              403,
            )
          }
          return c.json({
            memory: store.save({
              ...input,
              id: c.req.valid('param').memoryId,
            }),
          })
        } catch (error) {
          return c.json(
            {
              error:
                error instanceof Error ? error.message : 'Memory save failed',
            },
            400,
          )
        }
      },
    )
    .delete('/:memoryId', zValidator('param', IdSchema), (c) => {
      if (!store.remove(c.req.valid('param').memoryId)) {
        return c.json({ error: 'Unknown memory' }, 404)
      }
      return c.json({ success: true })
    })
}
