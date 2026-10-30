import { describe, expect, it } from 'bun:test'
import type { StagedAttachment } from '@/lib/attachments'
import { buildChatSendParams, toSidepanelFileParts } from './chat-send-params'

describe('chat send params and attachment projection', () => {
  it('preserves image data URLs, media types, and filenames', () => {
    const attachment: StagedAttachment = {
      id: 'image-1',
      kind: 'image',
      mediaType: 'image/png',
      name: 'diagram.png',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      payload: {
        kind: 'image',
        mediaType: 'image/png',
        name: 'diagram.png',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
      },
    }

    expect(toSidepanelFileParts([attachment])).toEqual([
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'diagram.png',
        url: 'data:image/png;base64,aW1hZ2U=',
      },
    ])
  })

  it('encodes UTF-8 text payloads as named data URL file parts', () => {
    const attachment: StagedAttachment = {
      id: 'file-1',
      kind: 'file',
      mediaType: 'text/plain',
      name: 'note.txt',
      payload: {
        kind: 'file',
        mediaType: 'text/plain',
        name: 'note.txt',
        text: 'hello 🌍',
      },
    }

    expect(toSidepanelFileParts([attachment])).toEqual([
      {
        type: 'file',
        mediaType: 'text/plain',
        filename: 'note.txt',
        url: 'data:text/plain;base64,aGVsbG8g8J+MjQ==',
      },
    ])
  })

  it('preserves tab actions and selected file parts in the same send request', () => {
    const tab = { id: 12, url: 'https://example.test' } as chrome.tabs.Tab
    const files = toSidepanelFileParts([
      {
        id: 'file-2',
        kind: 'file',
        mediaType: 'text/plain',
        name: 'notes.txt',
        payload: {
          kind: 'file',
          mediaType: 'text/plain',
          name: 'notes.txt',
          text: 'private notes',
        },
      },
    ])
    const params = buildChatSendParams({
      text: 'summarize this page with the notes',
      mode: 'agent',
      attachedTabs: [tab],
      files,
    })

    expect(params.text).toBe('summarize this page with the notes')
    expect(params.action).toMatchObject({
      type: 'browseros',
      mode: 'agent',
      message: params.text,
      tabs: [tab],
    })
    expect(params.files).toHaveLength(1)
    expect(params.files?.[0]).toMatchObject({
      type: 'file',
      filename: 'notes.txt',
      mediaType: 'text/plain',
    })
  })

  it('omits files when every selected file is removed', () => {
    expect(
      buildChatSendParams({
        text: 'question',
        mode: 'chat',
        attachedTabs: [],
      }),
    ).not.toHaveProperty('files')
  })
})
