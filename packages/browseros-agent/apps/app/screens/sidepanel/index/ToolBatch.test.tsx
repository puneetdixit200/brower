import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  sendToolApprovalResponse,
  ToolBatch,
  type ToolBatchProps,
} from './ToolBatch'

const pendingTool: ToolBatchProps['tools'][number] = {
  state: 'approval-requested',
  toolCallId: 'tool-call-1',
  toolName: 'send_message',
  input: { recipient: 'person@example.com', message: 'Hello' },
  output: undefined,
  approval: { id: 'approval-1', reason: 'Send this message?' },
}

function renderPendingApproval() {
  return renderToStaticMarkup(
    createElement(ToolBatch, {
      tools: [pendingTool],
      isLastBatch: true,
      isLastMessage: true,
      isStreaming: false,
      onToolApprovalResponse: () => {},
      onResumeHumanWait: async () => false,
    }),
  )
}

describe('ToolBatch approval controls', () => {
  it('renders a labeled group, pending status, and named native buttons', () => {
    const html = renderPendingApproval()

    expect(html).toContain('<fieldset')
    expect(html).toContain('<legend')
    expect(html).toContain('aria-describedby=')
    expect(html).toContain('role="status"')
    expect(html).toContain('Approval is required for Send message.')
    expect(html).toContain('aria-label="Approve Send message action"')
    expect(html).toContain('aria-label="Deny Send message action"')
    expect(html.match(/<button\b/g)).toHaveLength(3)
    expect(html.indexOf('>Approve</button>')).toBeLessThan(
      html.indexOf('>Deny</button>'),
    )
  })

  it('announces pending approvals on the collapsible trigger', () => {
    expect(renderPendingApproval()).toContain(
      'aria-label="0/1 actions completed; 1 action requires approval"',
    )
  })

  it('sends a denial for the approval ID', () => {
    const responses: Array<{ id: string; approved: boolean }> = []

    sendToolApprovalResponse(
      (response) => responses.push(response),
      'approval-1',
      'tool-call-1',
      false,
    )

    expect(responses).toEqual([{ id: 'approval-1', approved: false }])
  })
})

describe('ToolBatch human wait control', () => {
  it('shows a fixed, secret-free resume action for the suspended wait tool', () => {
    const html = renderToStaticMarkup(
      createElement(ToolBatch, {
        tools: [
          {
            state: 'input-available',
            toolCallId: 'opaque-request-id',
            toolName: 'wait_for_human',
            input: {},
            output: undefined,
          },
        ],
        isLastBatch: true,
        isLastMessage: true,
        isStreaming: true,
        onToolApprovalResponse: () => {},
        onResumeHumanWait: async () => true,
      }),
    )

    expect(html).toContain('Your browser needs you')
    expect(html).toContain('Complete the browser step yourself.')
    expect(html).toContain('I’m done, continue')
    expect(html).not.toContain('opaque-request-id')
  })
})
