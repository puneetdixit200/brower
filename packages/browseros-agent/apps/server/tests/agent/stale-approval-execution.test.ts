import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { ToolLoopAgent, type ToolSet, type UIMessage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import {
  DbActionPolicyStore,
  decideActionPolicy,
  enforceCurrentActionPolicyOnApproval,
} from '../../src/agent/action-policy'
import {
  addToolEnvelopeBoundary,
  buildAgentToolRunContexts,
  handleToolApproval,
} from '../../src/agent/ai-sdk-agent'
import { applyToolApprovalResponse } from '../../src/agent/tool-approval-response'
import { claimToolExecution } from '../../src/lib/conversations/tool-operation-claim-store'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'

const usage = {
  inputTokens: { total: 1, noCache: 1 },
  outputTokens: { total: 1, text: 1 },
}

let dbDir = ''

afterEach(async () => {
  closeDb()
  if (dbDir) await rm(dbDir, { recursive: true, force: true })
  dbDir = ''
})

describe('stale approval execution boundary', () => {
  it('rewrites a signed pending approval to Deny before SQLite claim or side-effect dispatch', async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'stale-approval-execution-'))
    const handle = initializeDb({ dbPath: join(dbDir, 'state.sqlite') })
    const policyStore = new DbActionPolicyStore(handle.db)
    const taskId = crypto.randomUUID()
    const toolCallId = 'stale-tabs-call'
    const execute = mock(async () => ({ ok: true }))
    let modelCall = 0
    const model = new MockLanguageModelV3({
      doGenerate: async (): Promise<LanguageModelV3GenerateResult> => {
        modelCall++
        return {
          content:
            modelCall === 1
              ? [
                  {
                    type: 'tool-call',
                    toolCallId,
                    toolName: 'tabs',
                    input: JSON.stringify({
                      action: 'new',
                      url: 'https://fixture.invalid',
                    }),
                  },
                ]
              : [{ type: 'text', text: 'The action was blocked.' }],
          finishReason: {
            unified: modelCall === 1 ? 'tool-calls' : 'stop',
            raw: modelCall === 1 ? 'tool_calls' : 'stop',
          },
          usage,
          warnings: [],
        }
      },
    })
    const tools = addToolEnvelopeBoundary(
      {
        tabs: {
          description: 'Open and manage browser tabs.',
          inputSchema: z.object({ action: z.literal('new'), url: z.string() }),
          execute,
        },
      } as ToolSet,
      claimToolExecution,
    )
    const agent = new ToolLoopAgent({
      model,
      tools,
      toolApproval: handleToolApproval,
      experimental_toolApprovalSecret: 'stale-approval-integration-test-secret',
      prepareCall: ({ options, ...call }) => ({
        ...call,
        toolsContext: buildAgentToolRunContexts(tools, options.taskId),
      }),
    })

    const pending = await agent.generate({
      prompt: 'Open a tab.',
      options: { taskId },
    })
    const pendingParts = pending.responseMessages.flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content
        : [],
    )
    const call = pendingParts.find((part) => part.type === 'tool-call')
    const approval = pendingParts.find(
      (part) => part.type === 'tool-approval-request',
    )
    expect(call?.type).toBe('tool-call')
    if (
      call?.type !== 'tool-call' ||
      approval?.type !== 'tool-approval-request'
    ) {
      throw new Error('Expected a signed pending tool approval')
    }
    expect(approval.toolCallId).toBe(toolCallId)
    expect((await policyStore.getDecision('browser.tabs.new')) ?? 'ask').toBe(
      'ask',
    )

    // Persist a new rule after the Ask approval card was created.
    await policyStore.put('browser.tabs.new', {
      decision: 'deny',
      expiresAt: null,
    })
    const messages: UIMessage[] = [
      {
        id: 'assistant-pending',
        role: 'assistant',
        parts: [
          {
            type: 'tool-tabs',
            toolCallId,
            state: 'approval-requested',
            input: call.input,
            approval: {
              id: approval.approvalId,
              reason: 'Review tab creation',
            },
          } as UIMessage['parts'][number],
        ],
      },
    ]
    const response = await enforceCurrentActionPolicyOnApproval(
      messages,
      { id: approval.approvalId, approved: true },
      decideActionPolicy,
    )
    expect(response).toMatchObject({
      approved: false,
      reason: 'Blocked by the current saved action policy.',
    })
    expect(applyToolApprovalResponse(messages, response)).toEqual({
      toolName: 'tabs',
    })

    // Feed the rewritten response into the real ToolLoopAgent signature gate and
    // execution boundary. A denial must bypass both the claim insert and tool body.
    await agent.generate({
      prompt: [
        { role: 'user', content: 'Open a tab.' },
        ...pending.responseMessages,
        {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: approval.approvalId,
              approved: response.approved,
            },
          ],
        },
      ],
      options: { taskId },
    })

    const claimCount = getDbHandle()
      .sqlite.prepare('SELECT COUNT(*) AS count FROM tool_operation_claims')
      .get() as { count: number }
    expect(claimCount.count).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })
})
