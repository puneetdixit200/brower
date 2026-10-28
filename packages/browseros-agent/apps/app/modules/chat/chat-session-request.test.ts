import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { resolvePanelTabId } from '@/lib/browseros/panelTab'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import type { LlmProviderConfig } from '@/lib/llm-providers/types'
import {
  buildRequestBrowserContext,
  buildSidepanelPreparedSendMessagesRequest,
  getOwnerTabSelection,
  getToolApprovalResponse,
  prepareSidepanelSendMessagesRequest,
} from './chat-session-request'
import type { SidepanelChatTarget } from './sidepanel-chat-targets'

const conversationId = '00000000-0000-4000-8000-000000000001'

describe('chat request preparation', () => {
  it('omits active and selected tab URL/title metadata for human login continuation only', () => {
    const activeTab = {
      id: 10,
      windowId: 2,
      url: 'https://login.example/reset/SECRET_PATH?token=SECRET_QUERY',
      title: 'SECRET_TITLE',
    } as chrome.tabs.Tab
    const selectedTab = {
      id: 20,
      url: 'https://verify.example/SECRET_SELECTED?otp=SECRET_OTP',
      title: 'SECRET_SELECTED_TITLE',
    } as chrome.tabs.Tab
    const continuationAction = createBrowserOSAction({
      mode: 'agent',
      message: 'Inspect the current page.',
      tabs: [selectedTab],
      contextPrivacy: 'human-login-continuation',
    })
    const context = buildRequestBrowserContext({
      activeTab,
      action: continuationAction,
      enabledMcpServers: [],
      customMcpServers: [],
    })
    const serializedContext = JSON.stringify(context)

    expect(context).toEqual({
      windowId: 2,
      activeTab: { id: 10 },
      selectedTabs: [{ id: 20 }],
    })
    for (const secret of [
      'SECRET_PATH',
      'SECRET_QUERY',
      'SECRET_TITLE',
      'SECRET_SELECTED_TITLE',
      'SECRET_OTP',
    ]) {
      expect(serializedContext).not.toContain(secret)
    }

    const ordinaryContext = buildRequestBrowserContext({
      activeTab,
      action: { ...continuationAction, contextPrivacy: undefined },
      enabledMcpServers: [],
      customMcpServers: [],
    })
    expect(ordinaryContext?.activeTab).toEqual({
      id: 10,
      url: activeTab.url,
      title: activeTab.title,
    })
    expect(ordinaryContext?.selectedTabs?.[0]).toEqual({
      id: 20,
      url: selectedTab.url,
      title: selectedTab.title,
    })
  })

  it('submits only the owning tab selection and its captured URL metadata', async () => {
    const ownerTabId = await resolvePanelTabId(
      'chrome-extension://assistant/sidepanel.html?tabId=10#/chat',
    )
    expect(ownerTabId).toBe(10)
    if (ownerTabId === undefined) throw new Error('Owner tab ID was not parsed')
    const ownerTab = {
      id: ownerTabId,
      url: 'https://owner.example/page',
      title: 'Owner page',
    }
    const ownerSelection = {
      text: 'owner-only selected text',
      url: 'https://owner.example/selected-source',
      title: 'Owner selection source',
    }
    const otherSelection = {
      text: 'other-tab secret text',
      url: 'https://other.example/private',
      title: 'Other tab title',
    }
    const selection = getOwnerTabSelection(ownerTab, {
      '10': ownerSelection,
      '20': otherSelection,
    })

    const request = buildSidepanelPreparedSendMessagesRequest({
      agentServerUrl: 'http://127.0.0.1:5151',
      target: llmTarget,
      fallbackProvider,
      message: 'Summarize the selected passage',
      browserContext: {
        activeTab: {
          id: ownerTab.id,
          url: ownerTab.url,
          title: ownerTab.title,
        },
      },
      selectedText: selection?.text,
      selectedTextSource: selection
        ? { url: selection.url, title: selection.title }
        : undefined,
      conversationId,
      mode: 'agent',
    })

    expect(request.body).toMatchObject({
      message: 'Summarize the selected passage',
      browserContext: {
        activeTab: {
          id: 10,
          url: 'https://owner.example/page',
          title: 'Owner page',
        },
      },
      selectedText: ownerSelection.text,
      selectedTextSource: {
        url: ownerSelection.url,
        title: ownerSelection.title,
      },
    })
    const serialized = JSON.stringify(request.body)
    expect(serialized).not.toContain(otherSelection.text)
    expect(serialized).not.toContain(otherSelection.url)
    expect(serialized).not.toContain(otherSelection.title)
  })

  it('fails closed for missing or invalid owner URLs through the submitted request', async () => {
    for (const url of [
      'chrome-extension://assistant/sidepanel.html',
      'chrome-extension://assistant/sidepanel.html?tabId=invalid',
    ]) {
      const ownerTabId = await resolvePanelTabId(url)
      expect(ownerTabId).toBeUndefined()
      const selection = getOwnerTabSelection(
        ownerTabId === undefined ? undefined : { id: ownerTabId },
        {
          '20': {
            text: 'other-tab selection',
            url: 'https://other.example',
            title: 'Other tab',
          },
        },
      )
      const request = buildSidepanelPreparedSendMessagesRequest({
        agentServerUrl: 'http://127.0.0.1:5151',
        target: llmTarget,
        fallbackProvider,
        message: 'Summarize this page',
        browserContext: undefined,
        selectedText: selection?.text,
        selectedTextSource: selection
          ? { url: selection.url, title: selection.title }
          : undefined,
        conversationId,
        mode: 'agent',
      })

      expect(request.body.browserContext).toBeUndefined()
      expect(request.body.selectedText).toBeUndefined()
      expect(request.body.selectedTextSource).toBeUndefined()
      expect(JSON.stringify(request.body)).not.toContain('other.example')
    }
  })

  it('sends BrowserOS providers to the unified chat endpoint', () => {
    const request = buildSidepanelPreparedSendMessagesRequest({
      agentServerUrl: 'http://127.0.0.1:5151',
      target: llmTarget,
      fallbackProvider,
      message: 'Summarize this page',
      ...commonRequestInput(),
    })

    expect(request.api).toBe('http://127.0.0.1:5151/chat')
    expect(request.body).toMatchObject({
      target: { type: 'browseros', providerId: 'openai-1' },
      message: 'Summarize this page',
    })
    // The provider is named, not described: its configuration is resolved
    // from the id on the server.
    expect('provider' in request.body).toBe(false)
    expect('model' in request.body).toBe(false)
    expect('reasoningEffort' in request.body).toBe(false)
  })

  it('sends ACP agents to the same endpoint without provider fields', () => {
    const request = buildSidepanelPreparedSendMessagesRequest({
      agentServerUrl: 'http://127.0.0.1:5151',
      target: acpTarget,
      fallbackProvider,
      message: 'Inspect the current tab',
      attachments: [
        {
          mediaType: 'image/png',
          data: 'data:image/png;base64,Zm9v',
        },
      ],
      ...commonRequestInput(),
    })

    expect(request.api).toBe('http://127.0.0.1:5151/chat')
    expect(request.body).toEqual({
      target: { type: 'codex', agentId: acpTarget.agentId },
      conversationId,
      message: 'Inspect the current tab',
      mode: 'agent',
      browserContext: commonRequestInput().browserContext,
      userSystemPrompt: 'Be concise',
      userWorkingDir: '/tmp/work',
      supportsImages: undefined,
      previousConversation: commonRequestInput().previousConversation,
      declinedApps: ['gmail'],
      selectedText: 'selected text',
      selectedTextSource: commonRequestInput().selectedTextSource,
      attachments: [
        {
          mediaType: 'image/png',
          data: 'data:image/png;base64,Zm9v',
        },
      ],
    })
    expect('provider' in request.body).toBe(false)
  })

  it('names no provider when nothing is connected', () => {
    // Undefined rather than a fabricated built-in provider. Naming one the
    // user never configured would run the turn on credentials they did not
    // choose; naming none lets the server answer that none is selected.
    const request = buildSidepanelPreparedSendMessagesRequest({
      agentServerUrl: 'http://127.0.0.1:5151',
      target: undefined,
      fallbackProvider: undefined,
      message: 'Summarize this page',
      ...commonRequestInput(),
    })

    expect(request.body).toMatchObject({
      target: { type: 'browseros', providerId: undefined },
    })
  })

  it('resolves the server URL for every send', async () => {
    let port = 9200
    const resolveAgentServerUrl = async () => `http://127.0.0.1:${port++}`

    const first = await prepareSidepanelSendMessagesRequest({
      resolveAgentServerUrl,
      target: llmTarget,
      fallbackProvider,
      ...commonRequestInput(),
    })
    const second = await prepareSidepanelSendMessagesRequest({
      resolveAgentServerUrl,
      target: llmTarget,
      fallbackProvider,
      ...commonRequestInput(),
    })

    expect(first.api).toBe('http://127.0.0.1:9200/chat')
    expect(second.api).toBe('http://127.0.0.1:9201/chat')
  })

  it('forwards only the approval decision from the responded assistant part', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-act',
          toolCallId: 'call-1',
          state: 'approval-responded',
          input: { kind: 'click', ref: 'e1' },
          approval: { id: 'approval-1', approved: false },
        },
      ],
    } as UIMessage

    expect(getToolApprovalResponse([message])).toEqual({
      id: 'approval-1',
      approved: false,
    })
  })

  it('adds approval decision to BrowserOS chat requests only when present', () => {
    const request = buildSidepanelPreparedSendMessagesRequest({
      agentServerUrl: 'http://127.0.0.1:5151',
      target: llmTarget,
      fallbackProvider,
      approvalResponse: { id: 'approval-1', approved: true },
      ...commonRequestInput(),
    })
    expect(request.body).toMatchObject({
      approvalResponse: { id: 'approval-1', approved: true },
    })
  })
})

function commonRequestInput() {
  return {
    conversationId,
    mode: 'agent' as const,
    browserContext: {
      activeTab: { id: 10, url: 'https://example.com', title: 'Example' },
      enabledMcpServers: ['slack'],
    },
    userSystemPrompt: 'Be concise',
    userWorkingDir: '/tmp/work',
    previousConversation: [
      { role: 'assistant' as const, content: 'Prior answer' },
    ],
    declinedApps: ['gmail'],
    selectedText: 'selected text',
    selectedTextSource: {
      url: 'https://example.com',
      title: 'Example',
    },
  }
}

const fallbackProvider: LlmProviderConfig = {
  id: 'openai-1',
  type: 'openai',
  name: 'OpenAI',
  modelId: 'gpt-5',
  supportsImages: true,
  contextWindow: 200000,
  temperature: 0.2,
  reasoningEffort: 'high',
  reasoningSummary: 'detailed',
  createdAt: 1,
  updatedAt: 1,
}

const llmTarget: SidepanelChatTarget = {
  kind: 'llm',
  id: fallbackProvider.id,
  name: fallbackProvider.name,
  type: fallbackProvider.type,
  provider: fallbackProvider,
}

const acpTarget: Extract<SidepanelChatTarget, { kind: 'acp' }> = {
  kind: 'acp',
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Review bot',
  type: 'acp',
  agentId: '00000000-0000-4000-8000-000000000002',
  agentType: 'codex',
  adapterName: 'Codex',
  modelId: 'gpt-5.5',
  modelLabel: 'GPT-5.5',
  reasoningEffort: 'medium',
}
