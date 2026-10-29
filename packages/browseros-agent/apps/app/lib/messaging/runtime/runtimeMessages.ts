import { defineExtensionMessaging } from '@webext-core/messaging'

export const RuntimeMessageType = {
  getTabId: 'runtime.getTabId',
  stopAgent: 'runtime.stopAgent',
  setSelectedText: 'runtime.setSelectedText',
  removeSelectedText: 'runtime.removeSelectedText',
  removeSelectedTextIfMatches: 'runtime.removeSelectedTextIfMatches',
} as const

export interface RuntimeTabIdResponse {
  tabId?: number
}

export interface RuntimeStopAgentData {
  conversationId: string
}

export interface RuntimeSelectedTextData {
  text: string
  pageUrl: string
  pageTitle: string
  tabId: number
  timestamp: number
}

type RuntimeMessagesProtocol = {
  [RuntimeMessageType.getTabId](): RuntimeTabIdResponse
  [RuntimeMessageType.stopAgent](data: RuntimeStopAgentData): void
  [RuntimeMessageType.setSelectedText](data: RuntimeSelectedTextData): void
  [RuntimeMessageType.removeSelectedText](data: { tabId: number }): void
  [RuntimeMessageType.removeSelectedTextIfMatches](data: {
    tabId: number
    selection: {
      text: string
      url: string
      title: string
      timestamp?: number
    }
  }): void
}

const { sendMessage, onMessage } =
  defineExtensionMessaging<RuntimeMessagesProtocol>()

export { onMessage as onRuntimeMessage, sendMessage as sendRuntimeMessage }
