import { describe, expect, it, mock } from 'bun:test'
import { addToolEnvelopeBoundary } from '../../src/agent/ai-sdk-agent'
import { buildNudgeToolSet } from '../../src/agent/nudge-tools'

describe('wait_for_human tool', () => {
  it('awaits the run-scoped gate using only the validated run id and opaque tool call id', async () => {
    const waitForHuman = mock(async (_runId: string, _requestId: string) => {})
    const tool = addToolEnvelopeBoundary(
      buildNudgeToolSet({ waitForHuman }),
    ).wait_for_human
    if (!tool?.execute) throw new Error('human wait tool was not registered')
    const runId = crypto.randomUUID()

    const result = await tool.execute({}, {
      toolCallId: 'opaque-provider-call-id',
      context: { taskId: runId },
    } as never)

    expect(waitForHuman).toHaveBeenCalledWith(runId, 'opaque-provider-call-id')
    expect(result).toEqual({
      content: [{ type: 'text', text: 'User resumed the task.' }],
      isError: false,
    })
  })
})
