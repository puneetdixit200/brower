import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { createElement, forwardRef, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Provider } from './chatComponentTypes'
import { ProcessingDisclosure } from './ProcessingDisclosure'

mock.module('@/components/elements/AppSelector', () => ({
  AppSelector: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}))
mock.module('@/components/elements/workspace-selector', () => ({
  WorkspaceSelector: ({ children }: { children: ReactNode }) =>
    createElement('div', null, children),
}))
mock.module('@/components/mcp/McpServerIcon', () => ({
  McpServerIcon: () => null,
}))
mock.module('@/lib/mcp/mcpServerStorage', () => ({
  useMcpServers: () => ({ servers: [] }),
}))
mock.module('@/lib/selected-text/selectedTextStorage', () => ({
  selectedTextStorage: {
    getValue: async () => ({}),
    setValue: async () => {},
    watch: () => () => {},
  },
}))
mock.module('@/modules/workspace/workspace.hooks', () => ({
  useWorkspace: () => ({ selectedFolder: null }),
}))
mock.module('./ChatAttachedTabs', () => ({ ChatAttachedTabs: () => null }))
mock.module('./ChatInput', () => ({
  ChatInput: forwardRef(() =>
    createElement('button', { type: 'button' }, 'Send'),
  ),
}))
mock.module('./ChatModeToggle', () => ({ ChatModeToggle: () => null }))
mock.module('./ChatSelectedText', () => ({ ChatSelectedText: () => null }))

let ChatFooter: typeof import('@/screens/sidepanel/index/ChatFooter').ChatFooter

beforeAll(async () => {
  ChatFooter = (await import('@/screens/sidepanel/index/ChatFooter')).ChatFooter
})

function provider(
  type: Provider['type'],
  kind: Provider['kind'] = 'llm',
): Provider {
  return { id: 'selected', name: 'Selected model', type, kind }
}

describe('ProcessingDisclosure', () => {
  it('explains the no-provider state', () => {
    const html = renderToStaticMarkup(
      createElement(ProcessingDisclosure, { provider: null }),
    )
    expect(html).toContain('No model connected')
    expect(html).toContain('Connect a model before sharing page context')
  })

  it('describes ACP routing without implying who receives the request', () => {
    const html = renderToStaticMarkup(
      createElement(ProcessingDisclosure, {
        provider: provider('qwen-code', 'acp'),
      }),
    )
    expect(html).toContain('External agent runtime')
    expect(html).toContain('may send your prompts and attached page context')
  })

  it.each(['ollama', 'lmstudio'] as const)(
    'warns that %s can use a remote configured endpoint',
    (type) => {
      const html = renderToStaticMarkup(
        createElement(ProcessingDisclosure, { provider: provider(type) }),
      )
      expect(html).toContain('Self-hosted endpoint')
      expect(html).toContain('may be on another computer')
    },
  )

  it('identifies custom OpenAI-compatible endpoint handling', () => {
    const html = renderToStaticMarkup(
      createElement(ProcessingDisclosure, {
        provider: provider('openai-compatible'),
      }),
    )
    expect(html).toContain('Custom provider endpoint')
    expect(html).toContain('Check its configured URL and privacy terms')
  })

  it('identifies cloud-backed providers and explicit attached context', () => {
    const html = renderToStaticMarkup(
      createElement(ProcessingDisclosure, { provider: provider('openai') }),
    )
    expect(html).toContain('Cloud-backed AI provider')
    expect(html).toContain('explicit attached page or tab context')
    expect(html).toContain('retention policies are separate from Aster')
  })
})

describe('side-panel disclosure plumbing', () => {
  it('renders the currently selected provider disclosure beside the send surface', () => {
    const html = renderToStaticMarkup(
      createElement(ChatFooter, {
        mode: 'chat',
        onModeChange: () => {},
        permissionMode: 'read-only',
        onPermissionModeChange: () => {},
        input: '',
        onInputChange: () => {},
        onSubmit: () => true,
        status: 'ready',
        onStop: () => {},
        attachedTabs: [],
        onToggleTab: () => {},
        onRemoveTab: () => {},
        selectedProvider: provider('ollama'),
      }),
    )
    expect(html).toContain('Self-hosted endpoint')
    expect(html).toContain('Send')
    expect(html.indexOf('Self-hosted endpoint')).toBeLessThan(
      html.indexOf('Send'),
    )
  })
})
