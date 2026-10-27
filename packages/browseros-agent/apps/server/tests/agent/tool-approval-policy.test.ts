import { describe, expect, it } from 'bun:test'
import { decideToolApproval } from '../../src/agent/tool-approval-policy'

describe('tool approval policy', () => {
  it('allows read-only browser observations and navigation', () => {
    expect(
      decideToolApproval({ toolName: 'tabs', input: { action: 'list' } }),
    ).toEqual({ required: false })
    expect(
      decideToolApproval({ toolName: 'snapshot', input: { page: 1 } }),
    ).toEqual({ required: false })
    expect(
      decideToolApproval({
        toolName: 'navigate',
        input: { url: 'https://example.com' },
      }),
    ).toEqual({ required: false })
  })

  it('requires review before browser interaction, code execution and file mutation', () => {
    for (const toolName of ['act', 'run', 'evaluate', 'filesystem_write']) {
      expect(
        decideToolApproval({ toolName, input: {} }).required,
        `${toolName} should require approval`,
      ).toBe(true)
    }
  })

  it('requires review for tab close and external side-effect connector tools', () => {
    expect(
      decideToolApproval({ toolName: 'tabs', input: { action: 'close' } })
        .required,
    ).toBe(true)
    expect(
      decideToolApproval({
        toolName: 'gmail_send_email',
        input: { to: 'fixture@example.test' },
      }).required,
    ).toBe(true)
    expect(
      decideToolApproval({
        toolName: 'custom_action',
        description: 'Submit the selected form to the remote service',
        input: {},
      }).required,
    ).toBe(true)
  })
})
