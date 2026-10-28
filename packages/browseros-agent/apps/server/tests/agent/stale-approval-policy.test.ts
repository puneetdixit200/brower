import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import {
  DbActionPolicyStore,
  decideActionPolicy,
  enforceCurrentActionPolicyOnApproval,
} from '../../src/agent/action-policy'
import { applyToolApprovalResponse } from '../../src/agent/tool-approval-response'
import { closeDb, initializeDb } from '../../src/lib/db'

let dbDir = ''

afterEach(async () => {
  closeDb()
  if (dbDir) await rm(dbDir, { recursive: true, force: true })
  dbDir = ''
})

function pendingCall(): UIMessage[] {
  return [
    {
      id: 'assistant-pending',
      role: 'assistant',
      parts: [
        {
          type: 'tool-tabs',
          toolCallId: 'tool-call-1',
          state: 'approval-requested',
          input: { action: 'new', url: 'https://fixture.invalid' },
          approval: { id: 'approval-stale', reason: 'Review tab creation' },
        } as UIMessage['parts'][number],
      ],
    },
  ]
}

describe('stale tool approval policy recheck', () => {
  it('denies an old Ask card after the saved action rule changes to Deny', async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'stale-approval-policy-'))
    const handle = initializeDb({ dbPath: join(dbDir, 'state.sqlite') })
    const store = new DbActionPolicyStore(handle.db)
    const messages = pendingCall()

    // The card was created while no saved rule existed, so the normal default was Ask.
    expect(
      (
        await decideActionPolicy({
          toolName: 'tabs',
          input: { action: 'new', url: 'https://fixture.invalid' },
        })
      ).decision,
    ).toBe('ask')

    await store.put('browser.tabs.new', { decision: 'deny', expiresAt: null })
    const response = await enforceCurrentActionPolicyOnApproval(
      messages,
      { id: 'approval-stale', approved: true },
      decideActionPolicy,
    )
    expect(response).toMatchObject({
      approved: false,
      reason: 'Blocked by the current saved action policy.',
    })

    applyToolApprovalResponse(messages, response)
    expect(messages[0]?.parts[0]).toMatchObject({
      state: 'approval-responded',
      input: { action: 'new', url: 'https://fixture.invalid' },
      approval: { id: 'approval-stale', approved: false },
    })
    expect(await store.getDecision('browser.tabs.new')).toBe('deny')
  })

  it('keeps an ordinary one-shot approval when the current rule still asks', async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'stale-approval-ask-'))
    initializeDb({ dbPath: join(dbDir, 'state.sqlite') })
    const messages = pendingCall()
    const response = await enforceCurrentActionPolicyOnApproval(
      messages,
      { id: 'approval-stale', approved: true },
      decideActionPolicy,
    )
    expect(response.approved).toBe(true)
    applyToolApprovalResponse(messages, response)
    expect(messages[0]?.parts[0]).toMatchObject({
      state: 'approval-responded',
      approval: { approved: true },
    })
    closeDb()
  })
})
