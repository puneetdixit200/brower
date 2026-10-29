import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import { DbMemoryStore } from '../../src/lib/memory/memory-store'

describe('memory revision history', () => {
  const dirs: string[] = []

  afterEach(async () => {
    closeDb()
    await Promise.all(
      dirs.map((dir) => rm(dir, { recursive: true, force: true })),
    )
    dirs.length = 0
  })

  test('orders successive edits and undo restores content, FTS, mirror, and task provenance', () => {
    const { store, dir } = createStore()
    store.updateSettings({ enabled: true, retentionDays: 90 })
    const sourceId = crypto.randomUUID()
    const entry = store.save({
      content: 'The deployment uses the release branch.',
      sourceId,
      sourceTitle: 'Find the deployment branch',
    })
    store.save({
      id: entry.id,
      content: 'The deployment uses the stable branch.',
    })
    store.save({
      id: entry.id,
      content: 'The deployment uses the protected branch.',
    })

    expect(store.history(entry.id).map((revision) => revision.content)).toEqual(
      [
        'The deployment uses the stable branch.',
        'The deployment uses the release branch.',
      ],
    )
    const restored = store.undo(entry.id)
    expect(restored?.content).toBe('The deployment uses the stable branch.')
    expect(restored?.sourceId).toBe(sourceId)
    expect(restored?.sourceTitle).toBe('Find the deployment branch')
    expect(store.search('protected branch')).toEqual([])
    expect(store.search('stable branch').map((note) => note.id)).toEqual([
      entry.id,
    ])
    const mirror = readFileSync(join(dir, 'memory', 'MEMORY.md'), 'utf8')
    expect(mirror).toContain('The deployment uses the stable branch.')
    expect(mirror).toContain(
      `Source task: Find the deployment branch (ID: ${sourceId})`,
    )

    expect(store.undo(entry.id)?.content).toBe(
      'The deployment uses the release branch.',
    )
    expect(store.history(entry.id)).toEqual([])
    expect(store.undo(entry.id)).toBeNull()
  })

  test('persists history across reopen and caps each note at twenty snapshots', () => {
    const { store, dir } = createStore()
    const entry = store.save({ content: 'Revision 0' })
    for (let index = 1; index <= 25; index += 1) {
      store.save({ id: entry.id, content: `Revision ${index}` })
    }
    expect(store.history(entry.id)).toHaveLength(20)
    expect(store.history(entry.id)[0]?.content).toBe('Revision 24')
    expect(store.history(entry.id).at(-1)?.content).toBe('Revision 5')

    closeDb()
    initializeDb({ dbPath: join(dir, 'aster.sqlite') })
    const reopened = new DbMemoryStore()
    expect(reopened.history(entry.id)).toHaveLength(20)
    for (let index = 0; index < 20; index += 1) reopened.undo(entry.id)
    expect(reopened.list().memories[0]?.content).toBe('Revision 5')
    expect(reopened.history(entry.id)).toEqual([])
  })

  test('enforces the global cap and removes history when notes expire or are deleted', () => {
    const { store, dir } = createStore()
    const sqlite = initializeDb({ dbPath: join(dir, 'aster.sqlite') }).sqlite
    const insert = sqlite.prepare(
      `INSERT INTO memory_revisions (memory_id, content, source, updated_at)
       VALUES (?, ?, 'user', ?)`,
    )
    for (let index = 0; index < 501; index += 1) {
      insert.run(crypto.randomUUID(), `seed ${index}`, index)
    }
    const note = store.save({ content: 'Temporary remembered build detail' })
    store.save({ id: note.id, content: 'Updated remembered build detail' })
    expect(
      sqlite
        .query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM memory_revisions',
        )
        .get()?.count,
    ).toBe(500)

    store.updateSettings({ enabled: true, retentionDays: 30 })
    sqlite
      .prepare('UPDATE memories SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1, note.id)
    expect(store.history(note.id)).toEqual([])
    const userNote = store.save({
      content: 'A note whose deletion is permanent',
    })
    store.save({
      id: userNote.id,
      content: 'Edited note whose deletion is permanent',
    })
    expect(store.remove(userNote.id)).toBe(true)
    expect(store.history(userNote.id)).toEqual([])
    expect(store.undo(userNote.id)).toBeNull()
  })

  test('rejected saves and malformed or credential-shaped Markdown edits add no revision', () => {
    const { store, dir } = createStore()
    const entry = store.save({ content: 'A safe original note' })
    expect(() =>
      store.save({ id: entry.id, content: 'password: never-save-this' }),
    ).toThrow(/credential/)
    expect(() =>
      store.save({
        id: entry.id,
        content: 'A safe note',
        sourceUrl: 'javascript:alert(1)',
      }),
    ).toThrow(/credential-free/)
    expect(store.history(entry.id)).toEqual([])

    const mirrorPath = join(dir, 'memory', 'MEMORY.md')
    const canonical = readFileSync(mirrorPath, 'utf8')
    writeFileSync(
      mirrorPath,
      canonical.replace(
        'A safe original note',
        'api_key: sk-abcdefghijklmnopqrstuvwxyz123456',
      ),
    )
    expect(() => store.list()).toThrow(/credential/)
    writeFileSync(mirrorPath, canonical)
    expect(store.history(entry.id)).toEqual([])
  })

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), 'aster-memory-revisions-'))
    dirs.push(dir)
    initializeDb({ dbPath: join(dir, 'aster.sqlite') })
    return { store: new DbMemoryStore(), dir }
  }
})
