import type { UIMessage } from 'ai'
import type { ChatRequest } from '../types'

/** Convert explicitly selected client files to the AI SDK's inline file parts. */
export function toChatFileParts(
  attachments: ChatRequest['attachments'],
): Array<Extract<UIMessage['parts'][number], { type: 'file' }>> {
  return (attachments ?? []).map((attachment) => ({
    type: 'file',
    mediaType: attachment.mediaType,
    url: attachment.data.startsWith('data:')
      ? attachment.data
      : `data:${attachment.mediaType};base64,${attachment.data}`,
    ...(attachment.name ? { filename: attachment.name } : {}),
  }))
}

/**
 * Keep file bytes in the display/persisted transcript, but submit them to the
 * model only with the user turn that explicitly selected them. A retry creates
 * a fresh current turn and can include its attachments again.
 */
export function buildModelFacingChatMessages(
  messages: UIMessage[],
  currentUserMessageId: string | undefined,
  promptUserText: string,
): UIMessage[] {
  const latestUserMessageId =
    currentUserMessageId ??
    [...messages].reverse().find((message) => message.role === 'user')?.id
  return messages.map((message) => {
    if (message.role !== 'user') return message

    const parts = message.parts.filter(
      (part) => message.id === latestUserMessageId || part.type !== 'file',
    )
    if (message.id !== currentUserMessageId || !currentUserMessageId) {
      return parts.length === message.parts.length
        ? message
        : { ...message, parts }
    }

    return {
      ...message,
      parts: [
        { type: 'text' as const, text: promptUserText },
        ...parts.filter((part) => part.type === 'file'),
      ],
    }
  })
}
