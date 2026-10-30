import type { UIMessage } from 'ai'
import { compact } from 'es-toolkit/array'
import type { Provider } from '../../components/chat/chatComponentTypes'
import type { ChatAction } from '../../lib/chat-actions/types'
import type { LlmProviderConfig } from '../../lib/llm-providers/types'
import type { ChatRequestBrowserContext } from '../../lib/messaging/server/buildChatRequestBody'
import { buildChatRequestBody } from '../../lib/messaging/server/buildChatRequestBody'
import {
  type SidepanelChatTarget,
  toLlmProviderConfig,
} from './sidepanel-chat-targets'

export type LlmChatRequestBodyInput = Parameters<typeof buildChatRequestBody>[0]

/** Return files from only the active user turn; older attachments must not replay. */
export function getLastUserMessageFiles(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') {
      return message.parts.filter((part) => part.type === 'file')
    }
  }
  return []
}

export interface OwnerTabSelection {
  text: string
  url: string
  title: string
  timestamp?: number
}

export interface PendingOwnerTabSelection {
  tabKey: string
  selection: OwnerTabSelection
}

export function snapshotOwnerTabSelection(
  tabId: number | undefined,
  selection: OwnerTabSelection | undefined,
): PendingOwnerTabSelection | null {
  if (tabId === undefined || !selection) return null
  const tabKey = String(tabId)
  return { tabKey, selection: { ...selection } }
}

/** True when a persisted selection still matches the one attached to a send. */
export function isSameOwnerTabSelection(
  current: OwnerTabSelection | undefined,
  sent: OwnerTabSelection,
): boolean {
  return (
    current?.text === sent.text &&
    current?.url === sent.url &&
    current?.title === sent.title &&
    current?.timestamp === sent.timestamp
  )
}

export function buildRequestBrowserContext({
  activeTab,
  action,
  enabledMcpServers,
  customMcpServers,
}: {
  activeTab?: chrome.tabs.Tab
  action?: ChatAction
  enabledMcpServers: Array<string | undefined>
  customMcpServers: { name: string; url?: string }[]
}): ChatRequestBrowserContext | undefined {
  const browserContext: ChatRequestBrowserContext = {}
  const omitTabMetadata =
    action?.type === 'browseros' &&
    action.contextPrivacy === 'human-login-continuation'

  if (activeTab) {
    browserContext.windowId = activeTab.windowId
    browserContext.activeTab = {
      id: activeTab.id,
      ...(omitTabMetadata
        ? {}
        : { url: activeTab.url, title: activeTab.title }),
    }
  }

  if (action?.tabs?.length) {
    browserContext.selectedTabs = action.tabs.map((tab) => ({
      id: tab.id,
      ...(omitTabMetadata ? {} : { url: tab.url, title: tab.title }),
    }))
  }

  const managedMcpServers = compact(enabledMcpServers)
  if (managedMcpServers.length) {
    browserContext.enabledMcpServers = managedMcpServers
  }
  if (customMcpServers.length) {
    browserContext.customMcpServers = customMcpServers
  }
  return Object.keys(browserContext).length ? browserContext : undefined
}

/** Resolve selected text only from the tab that owns the contextual panel. */
export function getOwnerTabSelection(
  ownerTab: Pick<chrome.tabs.Tab, 'id' | 'url' | 'title'> | undefined,
  selections: Record<string, OwnerTabSelection>,
): OwnerTabSelection | undefined {
  if (ownerTab?.id === undefined) return undefined
  const selection = selections[String(ownerTab.id)]
  if (!selection) return undefined

  return {
    text: selection.text,
    url: selection.url,
    title: selection.title,
    ...(selection.timestamp === undefined
      ? {}
      : { timestamp: selection.timestamp }),
  }
}

export function getToolApprovalResponse(messages: UIMessage[]) {
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
        state?: string
        approval?: { id?: string; approved?: boolean; reason?: string }
      }
      if (
        part.state === 'approval-responded' &&
        part.approval?.id &&
        typeof part.approval.approved === 'boolean'
      ) {
        return {
          id: part.approval.id,
          approved: part.approval.approved,
          ...(part.approval.reason ? { reason: part.approval.reason } : {}),
        }
      }
    }
  }
  return undefined
}

export type CommonSidepanelRequestInput = Omit<
  LlmChatRequestBodyInput,
  'provider' | 'message' | 'isScheduledTask'
>

export interface BuildSidepanelPreparedSendMessagesRequestInput
  extends CommonSidepanelRequestInput {
  agentServerUrl: string
  target: SidepanelChatTarget | undefined
  /**
   * Used when the target does not carry its own config. Undefined when nothing
   * is connected, which sends no provider id at all and lets the server answer
   * that none is selected.
   */
  fallbackProvider: LlmProviderConfig | undefined
  message?: string
  attachments?: Array<{ mediaType: string; data: string; name?: string }>
}

export interface PrepareSidepanelSendMessagesRequestInput
  extends Omit<
    BuildSidepanelPreparedSendMessagesRequestInput,
    'agentServerUrl'
  > {
  resolveAgentServerUrl: () => Promise<string>
}

export async function prepareSidepanelSendMessagesRequest({
  resolveAgentServerUrl,
  ...input
}: PrepareSidepanelSendMessagesRequestInput) {
  const agentServerUrl = await resolveAgentServerUrl()
  return buildSidepanelPreparedSendMessagesRequest({
    agentServerUrl,
    ...input,
  })
}

export function buildSidepanelPreparedSendMessagesRequest({
  agentServerUrl,
  target,
  fallbackProvider,
  message,
  ...common
}: BuildSidepanelPreparedSendMessagesRequestInput) {
  if (target?.kind === 'acp') {
    return {
      api: `${agentServerUrl}/chat`,
      body: {
        target: { type: target.agentType, agentId: target.agentId },
        conversationId: common.conversationId,
        message: message ?? '',
        mode: common.mode,
        ...(common.permissionMode
          ? { permissionMode: common.permissionMode }
          : {}),
        browserContext: common.browserContext,
        userSystemPrompt: common.userSystemPrompt,
        userWorkingDir: common.userWorkingDir,
        supportsImages: common.supportsImages,
        previousConversation: common.previousConversation,
        declinedApps: common.declinedApps,
        selectedText: common.selectedText,
        selectedTextSource: common.selectedTextSource,
        attachments: common.attachments?.length
          ? common.attachments
          : undefined,
        ...(common.approvalResponse
          ? { approvalResponse: common.approvalResponse }
          : {}),
      },
    }
  }

  const provider = toLlmProviderConfig(target) ?? fallbackProvider
  return {
    api: `${agentServerUrl}/chat`,
    body: buildChatRequestBody({
      ...common,
      provider,
      message,
    }),
  }
}

export function toProviderOption(target: SidepanelChatTarget): Provider {
  return {
    id: target.id,
    name: target.name,
    type: target.type,
    kind: target.kind,
    agentId: target.kind === 'acp' ? target.agentId : undefined,
    adapterName: target.kind === 'acp' ? target.adapterName : undefined,
    brandKey: target.kind === 'acp' ? target.brandKey : undefined,
    modelId: target.kind === 'llm' ? target.provider.modelId : undefined,
    reasoningEffort:
      target.kind === 'llm' ? target.provider.reasoningEffort : undefined,
    modelLabel: target.kind === 'acp' ? target.modelLabel : undefined,
  }
}
