/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { access, rm, writeFile } from 'node:fs/promises'
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

  it('allows only one claimant across separate Bun processes', async () => {
    createDatabase()
    if (!dbPath || !tempDir)
      throw new Error('Test database path was not initialized')
    const sharedDbPath = dbPath
    const sharedTempDir = tempDir
    closeDb()

    const storeUrl = new URL(
      '../../../src/lib/conversations/tool-operation-claim-store.ts',
      import.meta.url,
    ).href
    const dbUrl = new URL('../../../src/lib/db/index.ts', import.meta.url).href
    const goPath = join(sharedTempDir, 'go')
    const readyPaths = [
      join(sharedTempDir, 'ready-1'),
      join(sharedTempDir, 'ready-2'),
    ]
    const childScript = `
      const { initializeDb, closeDb } = await import(${JSON.stringify(dbUrl)})
      const { claimToolExecution } = await import(${JSON.stringify(storeUrl)})
      const worker = process.env.TOOL_CLAIM_WORKER
      const dbPath = process.env.TOOL_CLAIM_DB_PATH
      const goPath = process.env.TOOL_CLAIM_GO_PATH
      initializeDb({ dbPath })
      await Bun.write(process.env.TOOL_CLAIM_READY_PATH, 'ready')
      const deadline = Date.now() + 5000
      while (!(await Bun.file(goPath).exists())) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for race barrier')
        await Bun.sleep(10)
      }
      try {
        console.log(JSON.stringify({ won: claimToolExecution(${JSON.stringify(TASK_ID)}, 'provider-call-process-race', 1000), worker }))
      } finally {
        closeDb()
      }
    `
    const children = readyPaths.map((readyPath, index) =>
      Bun.spawn([process.execPath, '-e', childScript], {
        env: {
          ...process.env,
          TOOL_CLAIM_DB_PATH: sharedDbPath,
          TOOL_CLAIM_GO_PATH: goPath,
          TOOL_CLAIM_READY_PATH: readyPath,
          TOOL_CLAIM_WORKER: String(index),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )

    try {
      const readyDeadline = Date.now() + 5000
      while (
        !(
          await Promise.all(
            readyPaths.map((path) =>
              access(path).then(
                () => true,
                () => false,
              ),
            ),
          )
        ).every(Boolean)
      ) {
        if (Date.now() >= readyDeadline) {
          throw new Error(
            'Timed out waiting for claim workers to reach the barrier',
          )
        }
        await Bun.sleep(10)
      }
      await writeFile(goPath, 'go')

      const timedOut = Symbol('timed-out')
      let timeout: ReturnType<typeof setTimeout> | undefined
      const exitCodes = await Promise.race([
        Promise.all(children.map((child) => child.exited)),
        new Promise<typeof timedOut>((resolve) => {
          timeout = setTimeout(() => {
            children.forEach((child) => {
              child.kill()
            })
            resolve(timedOut)
          }, 10000)
        }),
      ])
      if (timeout) clearTimeout(timeout)
      const outputs = await Promise.all(
        children.map(async (child) => ({
          stdout: await new Response(child.stdout).text(),
          stderr: await new Response(child.stderr).text(),
        })),
      )
      expect(
        exitCodes,
        `claim worker timed out or failed: ${outputs.map((output) => output.stderr).join('\n')}`,
      ).not.toBe(timedOut)
      expect(
        exitCodes,
        `claim worker failed: ${outputs.map((output) => output.stderr).join('\n')}`,
      ).toEqual([0, 0])
      const results = outputs.map((output) => JSON.parse(output.stdout))
      expect(results.filter((result) => result.won)).toHaveLength(1)
      expect(results.filter((result) => !result.won)).toHaveLength(1)
    } finally {
      children.forEach((child) => {
        child.kill()
      })
    }
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
