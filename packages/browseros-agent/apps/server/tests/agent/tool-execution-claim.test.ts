import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { ToolLoopAgent, type ToolSet } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import {
  type AgentToolCallOptions,
  addToolEnvelopeBoundary,
  buildAgentToolRunContexts,
  handleToolApproval,
} from '../../src/agent/ai-sdk-agent'
import { claimToolExecution } from '../../src/lib/conversations/tool-operation-claim-store'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'

const usage = {
  inputTokens: { total: 1, noCache: 1 },
  outputTokens: { total: 1, text: 1 },
}

describe('tool execution claim boundary', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    closeDb()
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('claims a side-effect call before dispatch using the active run and provider call id', async () => {
    const taskId = crypto.randomUUID()
    const claim = mock(() => true)
    const execute = mock(async () => ({ ok: true }))
    const tools = addToolEnvelopeBoundary(
      {
        filesystem_write: {
          description: 'Write a file to the requested path.',
          execute,
        },
      } as never,
      claim,
      mock(() => true),
      mock(async () => ({
        decision: 'ask' as const,
        actionId: 'filesystem.write' as const,
      })),
    ) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >

    await tools.filesystem_write.execute(
      { path: '/workspace/note.txt', content: 'hello' },
      { toolCallId: 'provider-call-1', context: { taskId } },
    )

    expect(claim).toHaveBeenCalledWith(taskId, 'provider-call-1')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('fails closed on a duplicate claim without dispatching the tool', async () => {
    const taskId = crypto.randomUUID()
    const claim = mock(() => false)
    const execute = mock(async () => ({ ok: true }))
    const tools = addToolEnvelopeBoundary(
      {
        filesystem_write: {
          description: 'Write a file to the requested path.',
          execute,
        },
      } as never,
      claim,
      mock(() => true),
      mock(async () => ({
        decision: 'ask' as const,
        actionId: 'filesystem.write' as const,
      })),
    ) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >

    await expect(
      tools.filesystem_write.execute(
        { path: '/workspace/note.txt', content: 'hello' },
        { toolCallId: 'provider-call-1', context: { taskId } },
      ),
    ).rejects.toThrow(/refusing replay/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails closed without a matching fresh approval operation', async () => {
    const taskId = crypto.randomUUID()
    const execute = mock(async () => ({ ok: true }))
    const tools = addToolEnvelopeBoundary(
      { filesystem_write: { description: 'Write a file.', execute } } as never,
      mock(() => true),
      mock(() => false),
      mock(async () => ({
        decision: 'ask' as const,
        actionId: 'filesystem.write' as const,
      })),
    ) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >

    await expect(
      tools.filesystem_write.execute(
        { path: '/workspace/note.txt', content: 'hello' },
        { toolCallId: 'provider-call-no-grant', context: { taskId } },
      ),
    ).rejects.toThrow(/No fresh matching approval operation/)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not consume a side-effect claim for an allowlisted read', async () => {
    const taskId = crypto.randomUUID()
    const claim = mock(() => true)
    const execute = mock(async () => ({ text: 'page content' }))
    const tools = addToolEnvelopeBoundary(
      { read: { description: 'Read page content.', execute } } as never,
      claim,
      mock(() => true),
      mock(async () => ({ decision: 'ask' as const, actionId: null })),
    ) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >

    await tools.read.execute(
      { selector: 'main' },
      { toolCallId: 'provider-call-2', context: { taskId } },
    )

    expect(claim).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('validates the signed approved input before claiming, then refuses approval replay', async () => {
    const taskId = crypto.randomUUID()
    const seen = new Set<string>()
    const claim = mock((runId: string, callId: string) => {
      const key = `${runId}:${callId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const execute = mock(async () => 'sent')
    let modelCall = 0
    const toolCallId = 'provider-send-once-call'
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
                    toolName: 'send_message',
                    input: JSON.stringify({ destination: 'user@example.test' }),
                  },
                ]
              : [{ type: 'text', text: 'Done.' }],
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
        send_message: {
          description: 'Send a message to a recipient.',
          inputSchema: z.object({ destination: z.string() }),
          execute,
        },
      } as ToolSet,
      claim,
      mock(() => true),
      mock(async () => ({ decision: 'ask' as const, actionId: null })),
    )
    const agent = new ToolLoopAgent<AgentToolCallOptions, ToolSet>({
      model,
      tools,
      toolApproval: handleToolApproval,
      experimental_toolApprovalSecret: 'one-shot-claim-test-secret',
      prepareCall: ({ options, ...call }) => ({
        ...call,
        toolsContext: buildAgentToolRunContexts(tools, options.taskId),
      }),
    })

    const pending = await agent.generate({
      prompt: 'Send the message.',
      options: { taskId },
    })
    const approval = pending.responseMessages
      .flatMap((message) =>
        message.role === 'assistant' && Array.isArray(message.content)
          ? message.content
          : [],
      )
      .find((part) => part.type === 'tool-approval-request')
    if (approval?.type !== 'tool-approval-request') {
      throw new Error('Expected a signed tool approval request')
    }

    const approvalResponse = {
      role: 'tool' as const,
      content: [
        {
          type: 'tool-approval-response' as const,
          approvalId: approval.approvalId,
          approved: true,
        },
      ],
    }
    const originalPrompt = [
      { role: 'user' as const, content: 'Send the message.' },
      ...pending.responseMessages,
      approvalResponse,
    ]
    const tamperedPrompt = originalPrompt.map((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? {
            ...message,
            content: message.content.map((part) =>
              part.type === 'tool-call' && part.toolCallId === toolCallId
                ? { ...part, input: { destination: 'attacker@example.test' } }
                : part,
            ),
          }
        : message,
    )

    await expect(
      agent.generate({ prompt: tamperedPrompt, options: { taskId } }),
    ).rejects.toThrow(/signature/i)
    expect(claim).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()

    await agent.generate({ prompt: originalPrompt, options: { taskId } })
    await agent.generate({ prompt: originalPrompt, options: { taskId } })

    expect(claim).toHaveBeenCalledTimes(2)
    expect(claim).toHaveBeenCalledWith(taskId, toolCallId)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('dispatches only one of two concurrent approved ToolLoopAgent runs sharing a SQLite claim key', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-tool-claim-race-'))
    initializeDb({ dbPath: join(tempDir, 'state.sqlite') })

    const taskId = crypto.randomUUID()
    const toolCallId = 'provider-call-concurrent-replay'
    let waitingPolicies = 0
    let releasePolicies!: () => void
    const bothPoliciesReady = new Promise<void>((resolve) => {
      releasePolicies = resolve
    })
    const evaluatePolicy = async () => {
      waitingPolicies++
      if (waitingPolicies === 2) releasePolicies()
      await bothPoliciesReady
      return { decision: 'allow' as const, actionId: 'message.send' as const }
    }
    const execute = mock(async () => ({ ok: true }))

    function createAgent() {
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
                      toolName: 'send_message',
                      input: JSON.stringify({
                        destination: 'user@example.test',
                      }),
                    },
                  ]
                : [{ type: 'text', text: 'Finished.' }],
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
          send_message: {
            description: 'Send a message to a recipient.',
            inputSchema: z.object({ destination: z.string() }),
            execute,
          },
        } as ToolSet,
        claimToolExecution,
        mock(() => true),
        evaluatePolicy,
      )
      return new ToolLoopAgent<AgentToolCallOptions, ToolSet>({
        model,
        tools,
        toolApproval: handleToolApproval,
        experimental_toolApprovalSecret: 'concurrent-claim-race-test-secret',
        prepareCall: ({ options, ...call }) => ({
          ...call,
          toolsContext: buildAgentToolRunContexts(tools, options.taskId),
        }),
      })
    }

    const agents = [createAgent(), createAgent()]
    const pendingRuns = await Promise.all(
      agents.map((agent) =>
        agent.generate({
          prompt: 'Send the message.',
          options: { taskId },
        }),
      ),
    )
    const approvedPrompts = pendingRuns.map((pending) => {
      const approval = pending.responseMessages
        .flatMap((message) =>
          message.role === 'assistant' && Array.isArray(message.content)
            ? message.content
            : [],
        )
        .find((part) => part.type === 'tool-approval-request')
      if (approval?.type !== 'tool-approval-request') {
        throw new Error('Expected a signed tool approval request')
      }
      return [
        { role: 'user' as const, content: 'Send the message.' },
        ...pending.responseMessages,
        {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-approval-response' as const,
              approvalId: approval.approvalId,
              approved: true,
            },
          ],
        },
      ]
    })

    await Promise.all(
      agents.map((agent, index) => {
        const prompt = approvedPrompts[index]
        if (!prompt) throw new Error('Expected an approved prompt for each run')
        return agent.generate({ prompt, options: { taskId } })
      }),
    )

    expect(waitingPolicies).toBe(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(
      getDbHandle()
        .sqlite.prepare('SELECT COUNT(*) AS count FROM tool_operation_claims')
        .get(),
    ).toEqual({ count: 1 })
  })
})
