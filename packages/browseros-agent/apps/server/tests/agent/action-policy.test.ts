import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACTION_POLICY_CATALOG,
  DbActionPolicyStore,
  decideActionPolicy,
  validateActionPolicyInput,
} from '../../src/agent/action-policy'
import { closeDb, initializeDb } from '../../src/lib/db'
import { buildFilesystemToolSet } from '../../src/tools/filesystem/build-toolset'

let dir = ''
afterEach(async () => {
  closeDb()
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

async function openStore() {
  dir = await mkdtemp(join(tmpdir(), 'action-policy-'))
  const handle = initializeDb({ dbPath: join(dir, 'state.sqlite') })
  return new DbActionPolicyStore(handle.db)
}

describe('persistent action policy', () => {
  it('applies allow, ask, deny and bounded expiry before execution', async () => {
    const store = await openStore()
    const actions = await store.list()
    expect(actions).toHaveLength(ACTION_POLICY_CATALOG.length)
    expect(actions.every((action) => action.decision === 'ask')).toBe(true)
    expect(actions.every((action) => action.expiresAt === null)).toBe(true)
    const candidate = { toolName: 'tabs', input: { action: 'new' } }
    expect((await decideActionPolicy(candidate)).decision).toBe('ask')
    await store.put('browser.tabs.new', { decision: 'allow', expiresAt: null })
    expect((await decideActionPolicy(candidate)).decision).toBe('allow')
    await store.put('browser.tabs.new', { decision: 'deny', expiresAt: null })
    expect((await decideActionPolicy(candidate)).decision).toBe('deny')
    await store.put('browser.tabs.new', {
      decision: 'allow',
      expiresAt: Date.now() + 25,
    })
    await Bun.sleep(35)
    expect((await decideActionPolicy(candidate)).decision).toBe('ask')
  })

  it('keeps unknown tools and unknown actions at Ask despite neighboring grants', async () => {
    const store = await openStore()
    await store.put('browser.tabs.new', { decision: 'allow', expiresAt: null })
    expect(
      (
        await decideActionPolicy({
          toolName: 'tabs',
          input: { action: 'invented' },
        })
      ).decision,
    ).toBe('ask')
    expect(
      (await decideActionPolicy({ toolName: 'custom_tool', input: {} }))
        .decision,
    ).toBe('ask')
    expect(
      (await decideActionPolicy({ toolName: 'gmail_send_email', input: {} }))
        .decision,
    ).toBe('ask')
  })

  it('does not let an Allow add tools removed by Read-only capability gates', async () => {
    const store = await openStore()
    await store.put('filesystem.write', { decision: 'allow', expiresAt: null })
    const readOnlyTools = buildFilesystemToolSet(
      '/tmp/action-policy-workspace',
      {
        readOnly: true,
      },
    )
    expect(readOnlyTools).not.toHaveProperty('filesystem_write')
    expect(readOnlyTools).not.toHaveProperty('filesystem_edit')
    expect(readOnlyTools).not.toHaveProperty('filesystem_bash')
    expect(
      (await decideActionPolicy({ toolName: 'filesystem_read', input: {} }))
        .decision,
    ).toBe('allow')
    expect(
      (await decideActionPolicy({ toolName: 'Autofill.fill', input: {} }))
        .decision,
    ).toBe('ask')
  })

  it('persists rules after closing and reopening the SQLite database', async () => {
    const store = await openStore()
    await store.put('browser.act.click', { decision: 'deny', expiresAt: null })
    const path = join(dir, 'state.sqlite')
    closeDb()
    const reopened = initializeDb({ dbPath: path })
    expect(
      await new DbActionPolicyStore(reopened.db).getDecision(
        'browser.act.click',
      ),
    ).toBe('deny')
  })

  it('rejects forged IDs, malformed decisions, excess fields, and invalid expiry', () => {
    expect(
      validateActionPolicyInput({
        decision: 'allow',
        expiresAt: null,
        extra: true,
      }),
    ).toBeNull()
    expect(
      validateActionPolicyInput({
        decision: 'allow',
        expiresAt: Date.now() - 1,
      }),
    ).toBeNull()
    expect(
      validateActionPolicyInput({
        decision: 'allow',
        expiresAt: Date.now() + 367 * 86400000,
      }),
    ).toBeNull()
    expect(
      validateActionPolicyInput({ decision: 'auto', expiresAt: null }),
    ).toBeNull()
  })
})
