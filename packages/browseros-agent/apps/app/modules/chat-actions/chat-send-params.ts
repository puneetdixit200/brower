import type { FileUIPart } from 'ai'
import type { StagedAttachment } from '@/lib/attachments'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import type { ChatMode } from '@/modules/chat/chat-types'

export function buildChatSendParams(input: {
  text: string
  mode: ChatMode
  attachedTabs: chrome.tabs.Tab[]
  files?: FileUIPart[]
}): {
  text: string
  action?: ReturnType<typeof createBrowserOSAction>
  files?: FileUIPart[]
} {
  return {
    text: input.text,
    ...(input.attachedTabs.length
      ? {
          action: createBrowserOSAction({
            mode: input.mode,
            message: input.text,
            tabs: input.attachedTabs,
          }),
        }
      : {}),
    ...(input.files?.length ? { files: input.files } : {}),
  }
}

export function toSidepanelFileParts(
  attachments: readonly StagedAttachment[],
): FileUIPart[] {
  return attachments.map((attachment) => {
    const payload = attachment.payload
    const url =
      payload.kind === 'image'
        ? payload.dataUrl
        : `data:${payload.mediaType};base64,${encodeBase64(payload.text)}`
    return {
      type: 'file',
      mediaType: payload.mediaType,
      filename: payload.name,
      url,
    }
  })
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}
