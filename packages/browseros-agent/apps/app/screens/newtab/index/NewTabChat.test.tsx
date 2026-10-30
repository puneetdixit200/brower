import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createElement, type FC } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { ProcessingDisclosure } from '@/components/chat/ProcessingDisclosure'

const selectedProvider: Provider = {
  id: 'local-model',
  name: 'Local Ollama',
  type: 'ollama',
  kind: 'llm',
  modelId: 'llama3.2',
  modelLabel: 'Llama 3.2',
}
let stopErrorForTest: string | null = null

mock.module('react-router', () => ({
  useSearchParams: () => [new URLSearchParams(), () => {}],
}))
mock.module('@/modules/chat-actions/chat-actions.hooks', () => ({
  useChatActions: () => ({
    mode: 'chat',
    setMode: () => {},
    permissionMode: 'read-only',
    setPermissionMode: () => {},
    messages: [],
    sendMessage: () => {},
    respondToToolApproval: () => {},
    status: 'ready',
    agentUrlError: null,
    chatError: null,
    canSend: true,
    getActionForMessage: () => undefined,
    liked: {},
    onClickLike: () => {},
    disliked: {},
    onClickDislike: () => {},
    isRestoringConversation: false,
    restoreError: null,
    stopError: stopErrorForTest,
    retryRestoreConversation: () => {},
    conversationId: null,
    providers: [selectedProvider],
    selectedProvider,
    handleSelectProvider: () => {},
    resetConversation: () => {},
    input: '',
    setInput: () => {},
    attachedTabs: [],
    mounted: true,
    handleModeChange: () => {},
    handleStop: () => {},
    toggleTabSelection: () => {},
    removeTab: () => {},
    handleSubmit: () => {},
    handleSuggestionClick: () => {},
    retryLastTurn: async () => {},
    hasAnyTarget: true,
    isSettled: true,
    sendBlocked: false,
  }),
}))
mock.module('@/modules/conversations/active-conversation-context', () => ({
  useActiveConversation: () => ({ setId: () => {} }),
}))
mock.module('@/modules/conversations/history-list', () => ({
  conversationTitle: () => '',
}))
mock.module('@/screens/sidepanel/index/ChatEmptyState', () => ({
  ChatEmptyState: () => null,
}))
mock.module('@/screens/sidepanel/index/ChatError', () => ({
  ChatError: () => null,
}))
mock.module('@/screens/sidepanel/index/ChatHeader', () => ({
  ChatHeader: () => null,
}))
mock.module('@/screens/sidepanel/index/ChatMessages', () => ({
  ChatMessages: () => null,
}))
mock.module('@/components/chat/NoProviderNotice', () => ({
  NoProviderNotice: () => null,
}))
mock.module('@/screens/sidepanel/index/ChatFooter', () => ({
  ChatFooter: ({
    selectedProvider: provider,
  }: {
    selectedProvider?: Provider | null
  }) => createElement(ProcessingDisclosure, { provider: provider ?? null }),
}))

let NewTabChat: FC

beforeAll(async () => {
  NewTabChat = (await import('./NewTabChat')).NewTabChat
})

afterEach(() => {
  stopErrorForTest = null
})

describe('NewTabChat provider disclosure', () => {
  it('passes the selected provider through to the composer disclosure', () => {
    const html = renderToStaticMarkup(createElement(NewTabChat))

    expect(html).toContain('Self-hosted endpoint')
    expect(html).toContain('may be on another computer')
    expect(html).not.toContain('No model connected')
    expect(html).not.toContain('role="alert"')
  })

  it('announces a Stop failure accessibly', () => {
    stopErrorForTest =
      'Could not confirm the task stopped. It may still be running. Try Stop again.'
    const html = renderToStaticMarkup(createElement(NewTabChat))

    expect(html).toContain('role="alert"')
    expect(html).toContain(
      'Could not confirm the task stopped. It may still be running. Try Stop again.',
    )
    expect(html).toContain('Self-hosted endpoint')
  })
})
