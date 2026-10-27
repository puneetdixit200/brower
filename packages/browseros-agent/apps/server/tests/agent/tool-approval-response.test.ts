import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { applyToolApprovalResponse } from '../../src/agent/tool-approval-response'

const pendingMessage = (): UIMessage => ({
  id: 'assistant-1',
  role: 'assistant',
  parts: [
    {
      type: 'tool-act',
      toolCallId: 'call-1',
      state: 'approval-requested',
      input: { page: 7, kind: 'click', ref: 'e2' },
      approval: { id: 'approval-1', reason: 'Review this form action' },
    } as UIMessage['parts'][number],
  ],
})

describe('server-owned tool approval response', () => {
  it('changes only the matching pending approval and preserves the proposed action', () => {
    const messages = [pendingMessage()]
    expect(
      applyToolApprovalResponse(messages, {
        id: 'approval-1',
        approved: true,
      }),
    ).toEqual({ toolName: 'act' })
    expect(messages[0]?.parts[0]).toMatchObject({
      type: 'tool-act',
      toolCallId: 'call-1',
      state: 'approval-responded',
      input: { page: 7, kind: 'click', ref: 'e2' },
      approval: { id: 'approval-1', approved: true },
    })
  })

  it('does not accept unknown or previously answered approval ids', () => {
    const messages = [pendingMessage()]
    expect(
      applyToolApprovalResponse(messages, {
        id: 'forged-id',
        approved: true,
      }),
    ).toBeNull()
    expect(
      applyToolApprovalResponse(messages, {
        id: 'approval-1',
        approved: false,
      }),
    ).toEqual({ toolName: 'act' })
    expect(
      applyToolApprovalResponse(messages, {
        id: 'approval-1',
        approved: true,
      }),
    ).toBeNull()
  })

  it('records a denial without altering the tool input', () => {
    const messages = [pendingMessage()]
    applyToolApprovalResponse(messages, {
      id: 'approval-1',
      approved: false,
    })
    expect(messages[0]?.parts[0]).toMatchObject({
      state: 'approval-responded',
      input: { page: 7, kind: 'click', ref: 'e2' },
      approval: { id: 'approval-1', approved: false },
    })
  })
})
