import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
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

  function createDatabase(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'approval-operation-ledger-'))
    const dbPath = join(tempDir, 'browseros.sqlite')
    initializeDb({ dbPath })
    return dbPath
  }
})
