import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../../src/lib/db'
import { DbMemoryStore } from '../../../src/lib/memory/memory-store'

describe('DbMemoryStore', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    closeDb()
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    tempDirs.length = 0
  })

  test('persists explicit notes, indexes them only when enabled, and mirrors edits/deletes', () => {
    const store = createStore()
    const saved = store.save({
      content: 'Project Aster prefers a quiet dark green interface',
      sourceUrl: 'https://example.com/notes',
    })

    expect(store.search('dark green')).toEqual([])
    expect(
      store.updateSettings({ enabled: true, retentionDays: 90 }).enabled,
    ).toBe(true)
    expect(store.search('dark green').map((item) => item.id)).toEqual([
      saved.id,
    ])

    store.save({
      id: saved.id,
      content: 'Project Aster prefers a warm dark forest theme',
    })
    expect(store.search('dark green')).toEqual([])
    expect(store.search('forest theme')).toHaveLength(1)

    const markdownPath = join(tempDirs[0], 'memory', 'MEMORY.md')
    expect(existsSync(markdownPath)).toBe(true)
    expect(statSync(markdownPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(markdownPath, 'utf8')).toContain(
      'warm dark forest theme',
    )

    expect(store.remove(saved.id)).toBe(true)
    expect(store.search('forest theme')).toEqual([])
    expect(readFileSync(markdownPath, 'utf8')).not.toContain(
      'warm dark forest theme',
    )
  })

  test('survives database reopen and rejects credential-shaped content', () => {
    const store = createStore()
    const entry = store.save({ content: 'User prefers compact browser tabs' })
    expect(() =>
      store.save({ content: 'api_key: sk-abcdefghijklmnopqrstuvwxyz123456' }),
    ).toThrow(/credential/)
    expect(() =>
      store.save({
        content: 'Reference to an authenticated page',
        sourceUrl: 'https://example.com/?access_token=example',
      }),
    ).toThrow(/credential-free/)
    closeDb()

    const reopened = initializeDb({ dbPath: join(tempDirs[0], 'aster.sqlite') })
    expect(
      reopened.sqlite
        .query('SELECT id FROM memories WHERE id = ?')
        .get(entry.id),
    ).toBeTruthy()
    const freshStore = new DbMemoryStore()
    expect(freshStore.list().memories.map((memory) => memory.content)).toEqual([
      'User prefers compact browser tabs',
    ])
  })

  test('retention expiry removes rows and their FTS entries', () => {
    const store = createStore()
    store.updateSettings({ enabled: true, retentionDays: 30 })
    const entry = store.save({
      content: 'Temporary project note about library migration',
    })
    const sqlite = initializeDb({
      dbPath: join(tempDirs[0], 'aster.sqlite'),
    }).sqlite
    sqlite
      .prepare('UPDATE memories SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1, entry.id)

    expect(store.list().memories).toEqual([])
    expect(store.search('library migration')).toEqual([])
  })

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), 'aster-memory-test-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'aster.sqlite') })
    return new DbMemoryStore()
  }
})
