import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { getMessageSegments, hasPendingHumanWait } from './getMessageSegments'

describe('hasPendingHumanWait', () => {
  const messageWithWait = (state: string): UIMessage =>
    ({
      id: 'message-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-wait_for_human',
          toolCallId: 'request-1',
          state,
          input: {},
        },
      ],
    }) as unknown as UIMessage

  test('detects an unresolved wait tool part', () => {
    expect(hasPendingHumanWait([messageWithWait('input-available')])).toBe(true)
  })

  test('ignores a completed wait tool part', () => {
    expect(hasPendingHumanWait([messageWithWait('output-available')])).toBe(
      false,
    )
  })
})

describe('getMessageSegments', () => {
  test('keeps provider-executed tool parts regardless of call id prefix', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'acpx-call-1',
          toolName: 'browser_navigate',
          state: 'output-available',
          input: { url: 'https://example.com' },
          output: { title: 'Example' },
        },
      ],
    } as unknown as UIMessage

    expect(getMessageSegments(message, true, false)).toEqual([
      {
        type: 'tool-batch',
        key: 'message-1-tools-acpx-call-1',
        tools: [
          {
            state: 'output-available',
            toolCallId: 'acpx-call-1',
            toolName: 'browser_navigate',
            input: { url: 'https://example.com' },
            output: { title: 'Example' },
            approval: undefined,
          },
        ],
      },
    ])
  })
})
