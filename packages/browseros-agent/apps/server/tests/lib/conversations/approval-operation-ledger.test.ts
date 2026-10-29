import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { access, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  consumeApprovalOperation,
  issueApprovalOperation,
} from '../../../src/lib/conversations/approval-operation-ledger'
import { closeDb, getDbHandle, initializeDb } from '../../../src/lib/db'

const binding = () => ({
  taskId: '11111111-1111-4111-8111-111111111111',
  approvalId: 'approval-provider-secret',
  toolCallId: 'provider-call-secret',
  toolName: 'filesystem_write',
  actionId: 'filesystem.write',
  input: { path: '/private/path', content: 'private contents' },
})

describe('approval operation ledger', () => {
  let tempDir: string | undefined
  afterEach(async () => {
    closeDb()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('consumes a matching fresh grant exactly once and rejects changed bindings', () => {
    createDatabase()
    issueApprovalOperation(binding(), 1_000)
    const dispatch = binding()
    expect(consumeApprovalOperation(dispatch, 1_001)).toBe(true)
    expect(consumeApprovalOperation(dispatch, 1_002)).toBe(false)

    issueApprovalOperation(binding(), 2_000)
    expect(
      consumeApprovalOperation(
        { ...dispatch, approvalId: 'different-server-approved-approval' },
        2_001,
      ),
    ).toBe(false)
    expect(
      consumeApprovalOperation(
        { ...dispatch, input: { ...dispatch.input, content: 'changed' } },
        2_001,
      ),
    ).toBe(false)
    expect(
      consumeApprovalOperation(
        { ...dispatch, taskId: '22222222-2222-4222-8222-222222222222' },
        2_001,
      ),
    ).toBe(false)
    expect(
      consumeApprovalOperation(
        { ...dispatch, toolCallId: 'other-call' },
        2_001,
      ),
    ).toBe(false)
    expect(
      consumeApprovalOperation(
        { ...dispatch, actionId: 'filesystem.edit' },
        2_001,
      ),
    ).toBe(false)
  })

  it('survives database reopen and refuses expired authorization', () => {
    const dbPath = createDatabase()
    issueApprovalOperation(binding(), 1_000)
    closeDb()
    initializeDb({ dbPath })
    const dispatch = binding()
    expect(consumeApprovalOperation(dispatch, 1_001)).toBe(true)
    issueApprovalOperation(binding(), 5_000)
    expect(consumeApprovalOperation(dispatch, 5_000 + 10 * 60 * 1000)).toBe(
      false,
    )
  })

  it('atomically allows only one concurrent consumer', async () => {
    createDatabase()
    issueApprovalOperation(binding(), 1_000)
    const dispatch = binding()
    const outcomes = await Promise.all(
      Array.from({ length: 24 }, () =>
        Promise.resolve().then(() => consumeApprovalOperation(dispatch, 1_001)),
      ),
    )
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const rows = getDbHandle()
      .sqlite.query<{ consumed_at: number | null; input_hash: string }, []>(
        'SELECT consumed_at, input_hash FROM approval_operation_grants',
      )
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.consumed_at).toBe(1_001)
    expect(JSON.stringify(rows)).not.toContain('private')
    expect(JSON.stringify(rows)).not.toContain('provider-call-secret')
  })

  it('allows only one consumer across separate Bun processes', async () => {
    const sharedDbPath = createDatabase()
    if (!tempDir) throw new Error('Test database directory was not initialized')
    const sharedTempDir = tempDir
    issueApprovalOperation(binding(), 1_000)
    closeDb()

    const ledgerUrl = new URL(
      '../../../src/lib/conversations/approval-operation-ledger.ts',
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
      const { consumeApprovalOperation } = await import(${JSON.stringify(ledgerUrl)})
      const dbPath = process.env.APPROVAL_LEDGER_DB_PATH
      const goPath = process.env.APPROVAL_LEDGER_GO_PATH
      initializeDb({ dbPath })
      await Bun.write(process.env.APPROVAL_LEDGER_READY_PATH, 'ready')
      const deadline = Date.now() + 5000
      while (!(await Bun.file(goPath).exists())) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for race barrier')
        await Bun.sleep(10)
      }
      try {
        console.log(JSON.stringify({ consumed: consumeApprovalOperation(${JSON.stringify(binding())}, 1001) }))
      } finally {
        closeDb()
      }
    `
    const children = readyPaths.map((readyPath) =>
      Bun.spawn([process.execPath, '-e', childScript], {
        env: {
          ...process.env,
          APPROVAL_LEDGER_DB_PATH: sharedDbPath,
          APPROVAL_LEDGER_GO_PATH: goPath,
          APPROVAL_LEDGER_READY_PATH: readyPath,
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
            'Timed out waiting for approval consumers to reach the barrier',
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
        `approval consumer timed out or failed: ${outputs.map((output) => output.stderr).join('\n')}`,
      ).not.toBe(timedOut)
      expect(
        exitCodes,
        `approval consumer failed: ${outputs.map((output) => output.stderr).join('\n')}`,
      ).toEqual([0, 0])
      const results = outputs.map((output) => JSON.parse(output.stdout))
      expect(results.filter((result) => result.consumed)).toHaveLength(1)
      expect(results.filter((result) => !result.consumed)).toHaveLength(1)
    } finally {
      children.forEach((child) => {
        if (child.exitCode === null) child.kill()
      })
      await Promise.allSettled(children.map((child) => child.exited))
    }
  })

  function createDatabase(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'approval-operation-ledger-'))
    const path = join(tempDir, 'browseros.sqlite')
    initializeDb({ dbPath: path })
    return path
  }
})
