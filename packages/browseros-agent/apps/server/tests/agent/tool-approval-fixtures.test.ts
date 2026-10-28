import { describe, expect, it, mock } from 'bun:test'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { ToolLoopAgent } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { handleToolApproval } from '../../src/agent/ai-sdk-agent'

const usage = {
  inputTokens: { total: 1, noCache: 1 },
  outputTokens: { total: 1, text: 1 },
}

const fixtures = [
  { name: 'send_message', description: 'Send a message to a recipient.' },
  { name: 'post_update', description: 'Post an update to a channel.' },
  { name: 'make_payment', description: 'Make a payment to a merchant.' },
]

describe('ToolLoopAgent approval fixtures', () => {
  for (const selected of fixtures) {
    it(`runs only the explicitly approved ${selected.name} fixture`, async () => {
      const executions = Object.fromEntries(
        fixtures.map(({ name }) => [
          name,
          mock(async () => `${name} executed`),
        ]),
      ) as Record<string, ReturnType<typeof mock<() => Promise<string>>>>
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
                      toolCallId: 'fixture-call',
                      toolName: selected.name,
                      input: JSON.stringify({ destination: 'local fixture' }),
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

      const tools = Object.fromEntries(
        fixtures.map(({ name, description }) => [
          name,
          {
            description,
            inputSchema: z.object({ destination: z.string() }),
            execute: executions[name],
          },
        ]),
      )
      const agent = new ToolLoopAgent({
        model,
        tools,
        toolApproval: handleToolApproval,
        experimental_toolApprovalSecret: 'fixture-test-secret',
      })

      const pending = await agent.generate({
        prompt: 'Do the requested action.',
      })
      expect(
        Object.values(executions).every(
          (execute) => execute.mock.calls.length === 0,
        ),
      ).toBe(true)

      const approvalPart = pending.responseMessages
        .flatMap((message) =>
          message.role === 'assistant' && Array.isArray(message.content)
            ? message.content
            : [],
        )
        .find((part) => part.type === 'tool-approval-request')
      expect(approvalPart).toBeDefined()
      if (approvalPart?.type !== 'tool-approval-request') {
        throw new Error('Expected the server to request explicit approval')
      }

      await agent.generate({
        prompt: [
          { role: 'user', content: 'Do the requested action.' },
          ...pending.responseMessages,
          {
            role: 'tool',
            content: [
              {
                type: 'tool-approval-response',
                approvalId: approvalPart.approvalId,
                approved: true,
              },
            ],
          },
        ],
      })

      for (const { name } of fixtures) {
        expect(executions[name].mock.calls.length).toBe(
          name === selected.name ? 1 : 0,
        )
      }
    })
  }
})
