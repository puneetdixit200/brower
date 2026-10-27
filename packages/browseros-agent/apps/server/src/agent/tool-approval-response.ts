import type { UIMessage } from 'ai'

/** Applies only a decision to an approval request already stored by the server. */
export function applyToolApprovalResponse(
  messages: UIMessage[],
  response: { id: string; approved: boolean; reason?: string },
): { toolName: string } | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex]
    if (message.role !== 'assistant') continue
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex--
    ) {
      const part = message.parts[partIndex] as {
        type?: string
        state?: string
        toolName?: string
        approval?: { id?: string; approved?: boolean; reason?: string }
      }
      if (
        part.state !== 'approval-requested' ||
        part.approval?.id !== response.id
      ) {
        continue
      }
      message.parts[partIndex] = {
        ...part,
        state: 'approval-responded',
        approval: {
          ...part.approval,
          id: response.id,
          approved: response.approved,
          ...(response.reason ? { reason: response.reason } : {}),
        },
      } as UIMessage['parts'][number]
      return {
        toolName:
          part.type === 'dynamic-tool'
            ? (part.toolName ?? 'tool')
            : (part.type?.replace(/^tool-/, '') ?? 'tool'),
      }
    }
  }
  return null
}
