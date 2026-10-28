import { describe, expect, it } from 'bun:test'
import type { StagedAttachment } from '@/lib/attachments'
import {
  consumePendingHomeMessage,
  stagePendingHomeMessage,
} from './pending-home-message'

describe('pending home message', () => {
  it('hands selected tabs without putting IDs or prompt contents in a URL', () => {
    const token = stagePendingHomeMessage({
      text: 'private prompt',
      attachments: [],
      tabIds: [5, 7, -1, 7, Number.NaN, 14.2],
    })
    expect(token).not.toContain('private prompt')
    expect(consumePendingHomeMessage(token)).toEqual({
      text: 'private prompt',
      files: [],
      tabIds: [5, 7],
    })
    expect(consumePendingHomeMessage(token)).toBeNull()
  })

  it('hands text and standard file parts to the chat screen once', () => {
    const token = stagePendingHomeMessage({
      text: 'inspect this',
      attachments: [textAttachment()],
    })

    expect(consumePendingHomeMessage(token)).toEqual({
      text: 'inspect this',
      files: [
        {
          type: 'file',
          mediaType: 'text/plain',
          filename: 'notes.txt',
          url: 'data:text/plain;base64,aGVsbG8=',
        },
      ],
    })
    expect(consumePendingHomeMessage(token)).toBeNull()
  })
})

function textAttachment(): StagedAttachment {
  return {
    id: 'attachment-1',
    kind: 'file',
    mediaType: 'text/plain',
    name: 'notes.txt',
    payload: {
      kind: 'file',
      mediaType: 'text/plain',
      name: 'notes.txt',
      text: 'hello',
    },
  }
}
