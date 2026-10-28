import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import { siteRecipeStore } from '../../src/lib/memory/site-recipe-store'

const tempDirs: string[] = []

describe('siteRecipeStore', () => {
  afterEach(async () => {
    closeDb()
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  test('saves, reopens, lists and reports stale verification state', () => {
    const directory = createStore()
    const recipe = siteRecipeStore.save({
      origin: 'https://www.example.org/',
      title: '  Search for flights  ',
      instructions: 'Open the search form and choose the departure city.',
    })
    expect(recipe.origin).toBe('https://www.example.org')
    expect(recipe.title).toBe('Search for flights')
    expect(siteRecipeStore.list()[0]?.stale).toBe(true)
    siteRecipeStore.verify(recipe.id, recipe.origin)
    expect(siteRecipeStore.list()[0]?.stale).toBe(false)

    closeDb()
    initializeDb({ dbPath: join(directory, 'aster.sqlite') })
    expect(siteRecipeStore.list()[0]).toMatchObject({
      ...recipe,
      verifiedAt: expect.any(Number),
      stale: false,
    })
    const oldVerifiedAt = Date.now() - 31 * 86_400_000
    writeFileSync(
      recipePath(directory),
      JSON.stringify([
        {
          ...recipe,
          updatedAt: oldVerifiedAt - 1,
          verifiedAt: oldVerifiedAt,
        },
      ]),
    )
    expect(siteRecipeStore.list()[0]?.stale).toBe(true)
  })

  test('keeps save and verify readable when persisted timestamps are slightly ahead', () => {
    const directory = createStore()
    const path = recipePath(directory)
    mkdirSync(join(directory, 'memory'), { recursive: true })
    const future = validRecord()
    future.updatedAt = Date.now() + 2 * 60_000
    writeFileSync(path, JSON.stringify([future]))
    expect(siteRecipeStore.list()[0]?.id).toBe(future.id)

    const saved = siteRecipeStore.save({
      ...validInput(),
      title: 'Another workflow',
    })
    expect(siteRecipeStore.list().map(({ id }) => id)).toEqual([
      saved.id,
      future.id,
    ])

    writeFileSync(path, JSON.stringify([future]))
    const verified = siteRecipeStore.verify(future.id, future.origin)
    expect(verified.verifiedAt).toBeGreaterThanOrEqual(future.updatedAt)
    expect(siteRecipeStore.list()[0]?.stale).toBe(false)
  })

  test('rejects malformed JSON and malformed, oversized or duplicate records on all operations', () => {
    const directory = createStore()
    const path = recipePath(directory)
    mkdirSync(join(directory, 'memory'), { recursive: true })
    writeFileSync(path, '{broken')
    expect(() => siteRecipeStore.list()).toThrow(/JSON/)
    expect(() => siteRecipeStore.save(validInput())).toThrow(/JSON/)
    expect(() =>
      siteRecipeStore.verify(crypto.randomUUID(), 'https://example.org'),
    ).toThrow(/JSON/)
    expect(() => siteRecipeStore.delete(crypto.randomUUID())).toThrow(/JSON/)

    const good = validRecord()
    const invalidRecords: unknown[][] = [
      [{ ...good, origin: 'https://example.org/path' }],
      [{ ...good, title: '' }],
      [{ ...good, title: 42 }],
      [{ ...good, instructions: null }],
      [{ ...good, instructions: 'api_key=supersecret' }],
      [{ ...good, updatedAt: Number.POSITIVE_INFINITY }],
      [{ ...good, updatedAt: good.updatedAt + 600_000 }],
      [{ ...good, verifiedAt: good.updatedAt - 1 }],
      [{ ...good, verifiedAt: 'yesterday' }],
      [{ ...good, id: 'not-a-uuid' }],
      [{ ...good, extra: 'untrusted' }],
      [{ ...good }, { ...good }],
      [
        { ...good, updatedAt: good.updatedAt - 2 },
        { ...good, id: crypto.randomUUID(), updatedAt: good.updatedAt },
      ],
      [
        good,
        ...Array.from({ length: 150 }, (_, index) => ({
          ...good,
          id: crypto.randomUUID(),
          updatedAt: good.updatedAt - index - 1,
        })),
      ],
    ]
    for (const records of invalidRecords) {
      writeFileSync(path, JSON.stringify(records))
      expect(() => siteRecipeStore.list()).toThrow()
      expect(() => siteRecipeStore.save(validInput())).toThrow()
      expect(() => siteRecipeStore.verify(good.id, good.origin)).toThrow()
      expect(() => siteRecipeStore.delete(good.id)).toThrow()
    }
  })

  test('rejects non-public origins and unsafe direct save input', () => {
    const directory = createStore()
    for (const origin of [
      'http://example.org',
      'https://user:pass@example.org',
      'https://example.org/path',
      'https://localhost',
      'https://service.internal',
      'https://127.0.0.1',
      'https://[::1]',
      'https://example.org..',
    ]) {
      expect(() => siteRecipeStore.save({ ...validInput(), origin })).toThrow()
    }
    expect(() => siteRecipeStore.save({ ...validInput(), title: '' })).toThrow()
    expect(() =>
      siteRecipeStore.save({ ...validInput(), instructions: '  ' }),
    ).toThrow()
    expect(() =>
      siteRecipeStore.save({ ...validInput(), title: 'x'.repeat(121) }),
    ).toThrow()
    expect(() =>
      siteRecipeStore.save({ ...validInput(), instructions: 'x'.repeat(6001) }),
    ).toThrow()
    expect(() =>
      siteRecipeStore.save({
        ...validInput(),
        title: 'password: secret-value',
      }),
    ).toThrow(/credential/)
    expect(() =>
      siteRecipeStore.save({
        ...validInput(),
        instructions: 'Set the password = secret-value',
      }),
    ).toThrow(/credential/)
    const malformedOrigin = validRecord()
    malformedOrigin.origin = 'https://example.org..'
    mkdirSync(join(directory, 'memory'), { recursive: true })
    writeFileSync(recipePath(directory), JSON.stringify([malformedOrigin]))
    expect(() => siteRecipeStore.list()).toThrow(/hostname|origin/i)
  })
})

function createStore(): string {
  const directory = mkdtempSync(join(tmpdir(), 'site-recipes-test-'))
  tempDirs.push(directory)
  initializeDb({ dbPath: join(directory, 'aster.sqlite') })
  return directory
}

function recipePath(directory: string): string {
  return join(directory, 'memory', 'site-recipes.json')
}

function validInput() {
  return {
    origin: 'https://example.org',
    title: 'Example workflow',
    instructions: 'Open the settings page and select the preferred language.',
  }
}

function validRecord() {
  return {
    id: crypto.randomUUID(),
    ...validInput(),
    updatedAt: Date.now(),
    verifiedAt: null,
  }
}
