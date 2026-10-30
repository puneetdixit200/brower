import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { buildModelFacingChatMessages } from '../../../src/api/services/chat-message-attachments'

const selectedFile = {
  type: 'file' as const,
  mediaType: 'text/plain',
  url: 'data:text/plain;base64,c2VudGluZWw=',
  filename: 'selected.txt',
}

describe('model-facing selected attachments', () => {
  it('keeps the latest user file on approval continuation without rewriting its text', () => {
    const messages = [
      {
        id: 'user-with-file',
        role: 'user',
        parts: [{ type: 'text', text: 'Read this file.' }, selectedFile],
      },
      {
        id: 'assistant-pending',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Approve the requested action.' }],
      },
    ] satisfies UIMessage[]

    const prompt = buildModelFacingChatMessages(messages, undefined, '')
    expect(prompt[0]?.parts).toEqual(messages[0]?.parts)
  })

  it('removes previous-turn files from the model projection but keeps current files', () => {
    const messages = [
      {
        id: 'old-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Old turn.' }, selectedFile],
      },
      {
        id: 'current-user',
        role: 'user',
        parts: [{ type: 'text', text: 'Current turn.' }, selectedFile],
      },
    ] satisfies UIMessage[]

    const prompt = buildModelFacingChatMessages(
      messages,
      'current-user',
      '<USER_QUERY>Current turn.</USER_QUERY>',
    )
    expect(prompt[0]?.parts).toEqual([{ type: 'text', text: 'Old turn.' }])
    expect(prompt[1]?.parts).toEqual([
      { type: 'text', text: '<USER_QUERY>Current turn.</USER_QUERY>' },
      selectedFile,
    ])
    expect(messages[0]?.parts).toContainEqual(selectedFile)
  })
})
