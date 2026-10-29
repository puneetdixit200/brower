import { describe, expect, it, mock } from 'bun:test'
import { addToolEnvelopeBoundary } from '../../src/agent/ai-sdk-agent'

describe('tool execution claim boundary', () => {
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

  it('does not consume a side-effect claim for an allowlisted read', async () => {
    const taskId = crypto.randomUUID()
    const claim = mock(() => true)
    const execute = mock(async () => ({ text: 'page content' }))
    const tools = addToolEnvelopeBoundary(
      { read: { description: 'Read page content.', execute } } as never,
      claim,
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
})
