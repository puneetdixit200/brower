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
    expect(
      decideToolApproval({ toolName: 'history', input: { maxResults: 10 } }),
    ).toEqual({ required: false })
    expect(
      decideToolApproval({ toolName: 'tab_groups', input: { action: 'list' } }),
    ).toEqual({ required: false })
    expect(
      decideToolApproval({ toolName: 'windows', input: { action: 'list' } }),
    ).toEqual({ required: false })
    expect(
      decideToolApproval({
        toolName: 'suggest_schedule',
        description: 'Suggest scheduling a task',
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
    for (const action of ['close', 'new', 'pin', 'move', 'duplicate', 'unknown']) {
      expect(
        decideToolApproval({ toolName: 'tabs', input: { action } }).required,
        `tabs/${action} should require approval`,
      ).toBe(true)
    }
    expect(
      decideToolApproval({ toolName: 'tabs', input: { action: 'active' } })
        .required,
    ).toBe(false)
    expect(
      decideToolApproval({ toolName: 'history', input: { action: 'delete' } })
        .required,
    ).toBe(true)
    expect(
      decideToolApproval({
        toolName: 'tab_groups',
        input: { action: 'create' },
      }).required,
    ).toBe(true)
    expect(
      decideToolApproval({ toolName: 'windows', input: { action: 'close' } })
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
    expect(
      decideToolApproval({ toolName: 'unclassified_external_tool' }),
    ).toMatchObject({
      required: true,
    })
    for (const toolName of [
      'calendar_create_event',
      'slack_post_message',
      'filesystem_edit',
      'filesystem_bash',
    ]) {
      expect(
        decideToolApproval({ toolName, input: {} }).required,
        `${toolName} should require approval`,
      ).toBe(true)
    }
    for (const toolName of [
      'filesystem_read',
      'filesystem_ls',
      'filesystem_grep',
      'filesystem_find',
    ]) {
      expect(
        decideToolApproval({ toolName, input: {} }).required,
        `${toolName} should stay read-only`,
      ).toBe(false)
    }
  })
})
