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

/** Project active-turn files into the request format used by both send and retry. */
export function getLastUserMessageAttachments(messages: UIMessage[]) {
  return getLastUserMessageFiles(messages).map((file) => ({
    mediaType: file.mediaType,
    data: file.url,
    ...(file.filename ? { name: file.filename } : {}),
  }))
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
  const hasExplicitAttachments = Boolean(action?.tabs?.length)

  // Explicitly attached pages are the user's chosen context. The sidepanel
  // owner is not an implicit extra page when the user attached another tab.
  if (activeTab && !hasExplicitAttachments) {
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
      windowId: tab.windowId,
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

/**
 * Verify that every page explicitly attached to a turn is still the same tab
 * in the same window at the same URL. The action remains the submitted
 * snapshot; this is a last-moment guard against silently using changed
 * context, not a refresh from the active tab.
 */
export async function assertActionTabsUnchanged(
  action: ChatAction | undefined,
  getTab: (tabId: number) => Promise<chrome.tabs.Tab> = (tabId) =>
    chrome.tabs.get(tabId),
): Promise<void> {
  for (const attached of action?.tabs ?? []) {
    await assertTabSnapshotUnchanged(attached, getTab, 'attached')
  }
}

export async function assertOwnerTabUnchanged(
  ownerTab: chrome.tabs.Tab | undefined,
  getTab: (tabId: number) => Promise<chrome.tabs.Tab> = (tabId) =>
    chrome.tabs.get(tabId),
): Promise<void> {
  if (ownerTab) await assertTabSnapshotUnchanged(ownerTab, getTab, 'owner')
}

async function assertTabSnapshotUnchanged(
  snapshot: chrome.tabs.Tab,
  getTab: (tabId: number) => Promise<chrome.tabs.Tab>,
  pageKind: 'attached' | 'owner',
): Promise<void> {
  const guidance =
    pageKind === 'attached'
      ? 'Remove it and attach it again.'
      : 'Reopen the sidepanel from the current page and retry.'
  const label =
    pageKind === 'attached' ? 'An attached page' : 'The sidepanel page'
  const tabId = snapshot.id
  if (tabId === undefined) {
    throw new Error(`${label} has no tab identity. ${guidance}`)
  }

  let current: chrome.tabs.Tab
  try {
    current = await getTab(tabId)
  } catch {
    throw new Error(
      `${label} was closed or is no longer accessible. ${guidance}`,
    )
  }

  if (
    snapshot.windowId === undefined ||
    current.windowId !== snapshot.windowId
  ) {
    throw new Error(`${label} moved to another window. ${guidance}`)
  }

  if (!snapshot.url || !current.url || current.url !== snapshot.url) {
    throw new Error(
      `${label} changed its address after context selection. ${guidance}`,
    )
  }
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
  validateBrowserContext?: () => Promise<void>
}

export async function prepareSidepanelSendMessagesRequest({
  resolveAgentServerUrl,
  validateBrowserContext,
  ...input
}: PrepareSidepanelSendMessagesRequestInput) {
  const agentServerUrl = await resolveAgentServerUrl()
  // Server URL discovery can await storage. Revalidate after it so a tab
  // navigation during setup is rejected before the request is prepared.
  await validateBrowserContext?.()
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
