/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimToolExecution } from '../../../src/lib/conversations/tool-operation-claim-store'
import { closeDb, getDbHandle, initializeDb } from '../../../src/lib/db'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TASK_ID = '22222222-2222-4222-8222-222222222222'
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

describe('tool operation claim store', () => {
  let tempDir: string | undefined
  let dbPath: string | undefined

  afterEach(async () => {
    closeDb()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
    dbPath = undefined
  })

  it('atomically allows only one concurrent claim for the scoped key', async () => {
    createDatabase()
    const outcomes = await Promise.all(
      Array.from({ length: 32 }, () =>
        Promise.resolve().then(() =>
          claimToolExecution(TASK_ID, 'provider-call-secret', 1_000),
        ),
      ),
    )

    expect(outcomes.filter(Boolean)).toHaveLength(1)
    expect(outcomes.filter((outcome) => !outcome)).toHaveLength(31)
    expect(
      claimToolExecution(OTHER_TASK_ID, 'provider-call-secret', 1_000),
    ).toBe(true)
    expect(claimToolExecution(TASK_ID, 'another-provider-call', 1_000)).toBe(
      true,
    )

    const rows = getDbHandle()
      .sqlite.query<{ claim_key: string; expires_at: number }, []>(
        'SELECT claim_key, expires_at FROM tool_operation_claims ORDER BY expires_at',
      )
      .all()
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.claim_key))).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('provider-call-secret')
    expect(rows[0]?.expires_at).toBe(1_000 + TOMBSTONE_TTL_MS)
  })

  it('retains a replay tombstone across closing and reopening the database', () => {
    createDatabase()
    expect(claimToolExecution(TASK_ID, 'provider-call-reopen', 10_000)).toBe(
      true,
    )

    closeDb()
    if (!dbPath) throw new Error('Test database path was not initialized')
    initializeDb({ dbPath })

    expect(claimToolExecution(TASK_ID, 'provider-call-reopen', 20_000)).toBe(
      false,
    )
  })

  it('allows reuse only after the bounded tombstone horizon expires', () => {
    createDatabase()
    expect(claimToolExecution(TASK_ID, 'provider-call-expiry', 50_000)).toBe(
      true,
    )
    expect(
      claimToolExecution(
        TASK_ID,
        'provider-call-expiry',
        50_000 + TOMBSTONE_TTL_MS,
      ),
    ).toBe(true)
  })

  it('throws on storage failure so callers can fail closed', () => {
    createDatabase()
    getDbHandle().sqlite.exec('DROP TABLE tool_operation_claims')

    expect(() =>
      claimToolExecution(TASK_ID, 'provider-call-failure', 1_000),
    ).toThrow()
  })

  function createDatabase(): void {
    tempDir = mkdtempSync(join(tmpdir(), 'tool-operation-claims-'))
    dbPath = join(tempDir, 'browseros.sqlite')
    initializeDb({ dbPath })
  }
})
