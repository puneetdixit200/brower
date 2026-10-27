import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

  test('stores reviewed task provenance and retains it when the note is edited', () => {
    const store = createStore()
    const sourceId = crypto.randomUUID()
    const entry = store.save({
      content: 'The project deploys from the release branch.',
      sourceId,
      sourceTitle: 'Find the release branch used by this project',
    })

    expect(entry.source).toBe('task')
    expect(entry.sourceId).toBe(sourceId)
    expect(entry.sourceTitle).toBe(
      'Find the release branch used by this project',
    )

    const edited = store.save({
      id: entry.id,
      content: 'The project deploys from the protected release branch.',
    })
    expect(edited.source).toBe('task')
    expect(edited.sourceId).toBe(sourceId)
    expect(edited.sourceTitle).toBe(
      'Find the release branch used by this project',
    )
    expect(() =>
      store.save({
        content: 'A safe note',
        sourceId,
        sourceTitle: 'API key: secret-value',
      }),
    ).toThrow(/credential/)
  })

  test('imports content-only Markdown edits into SQLite and FTS', () => {
    const store = createStore()
    store.updateSettings({ enabled: true, retentionDays: 90 })
    const entry = store.save({ content: 'The project uses a blue theme.' })
    const markdownPath = join(tempDirs[0], 'memory', 'MEMORY.md')
    const before = readFileSync(markdownPath, 'utf8')
    writeFileSync(
      markdownPath,
      before.replace(
        'The project uses a blue theme.',
        'The project uses a violet theme.',
      ),
    )

    expect(store.search('blue theme')).toEqual([])
    expect(store.search('violet theme').map((note) => note.id)).toEqual([
      entry.id,
    ])
    expect(store.list().memories[0]?.content).toBe(
      'The project uses a violet theme.',
    )
    expect(readFileSync(markdownPath, 'utf8')).toContain(
      'The project uses a violet theme.',
    )
  })

  test('repairs a stale mirror timestamp after an interrupted mirror rewrite', () => {
    const store = createStore()
    const entry = store.save({ content: 'The project uses a blue theme.' })
    const markdownPath = join(tempDirs[0], 'memory', 'MEMORY.md')
    const staleMirror = readFileSync(markdownPath, 'utf8').replace(
      'The project uses a blue theme.',
      'The project uses a violet theme.',
    )
    const interruptedUpdatedAt = Date.now() + 1_000
    initializeDb({ dbPath: join(tempDirs[0], 'aster.sqlite') })
      .sqlite.prepare(
        'UPDATE memories SET content = ?, updated_at = ? WHERE id = ?',
      )
      .run('The project uses a violet theme.', interruptedUpdatedAt, entry.id)
    writeFileSync(markdownPath, staleMirror)

    expect(store.list().memories[0]?.content).toBe(
      'The project uses a violet theme.',
    )
    expect(readFileSync(markdownPath, 'utf8')).toContain(
      `Updated: ${new Date(interruptedUpdatedAt).toISOString()}`,
    )
  })

  test('fails closed on malformed or credential-shaped Markdown edits', () => {
    const store = createStore()
    store.updateSettings({ enabled: true, retentionDays: 90 })
    store.save({ content: 'The project uses a blue theme.' })
    const markdownPath = join(tempDirs[0], 'memory', 'MEMORY.md')
    const canonical = readFileSync(markdownPath, 'utf8')

    writeFileSync(
      markdownPath,
      canonical.replace('Source: user', 'Source: forged'),
    )
    expect(() => store.list()).toThrow(/metadata is read-only/)
    expect(
      initializeDb({ dbPath: join(tempDirs[0], 'aster.sqlite') })
        .sqlite.query<{ content: string }, []>('SELECT content FROM memories')
        .get()?.content,
    ).toBe('The project uses a blue theme.')

    writeFileSync(
      markdownPath,
      canonical.replace(
        'The project uses a blue theme.',
        'password: do-not-store-this-value',
      ),
    )
    expect(() => store.list()).toThrow(/credential/)
    expect(
      initializeDb({ dbPath: join(tempDirs[0], 'aster.sqlite') })
        .sqlite.query<{ content: string }, []>('SELECT content FROM memories')
        .get()?.content,
    ).toBe('The project uses a blue theme.')

    writeFileSync(
      markdownPath,
      canonical.replace(/^## [^\n]+\n/m, '## malformed\n'),
    )
    expect(() => store.list()).toThrow(/malformed|IDs changed/)
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

  test('retention expiry is enforced after reopening the database', () => {
    const store = createStore()
    store.updateSettings({ enabled: true, retentionDays: 90 })
    const entry = store.save({
      content: 'Temporary note about database reopen retention',
    })
    initializeDb({ dbPath: join(tempDirs[0], 'aster.sqlite') })
      .sqlite.prepare('UPDATE memories SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1, entry.id)

    closeDb()
    initializeDb({ dbPath: join(tempDirs[0], 'aster.sqlite') })
    const reopenedStore = new DbMemoryStore()

    expect(reopenedStore.list().memories).toEqual([])
    expect(reopenedStore.search('database reopen retention')).toEqual([])
  })

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), 'aster-memory-test-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'aster.sqlite') })
    return new DbMemoryStore()
  }
})
