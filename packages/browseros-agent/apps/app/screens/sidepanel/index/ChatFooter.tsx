import type { FileUIPart } from 'ai'
import { ChevronDown, Folder, Layers, PlugZap } from 'lucide-react'
import type { FC, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { ProcessingDisclosure } from '@/components/chat/ProcessingDisclosure'
import { AppSelector } from '@/components/elements/AppSelector'
import { WorkspaceSelector } from '@/components/elements/workspace-selector'
import { McpServerIcon } from '@/components/mcp/McpServerIcon'
import type { StagedAttachment } from '@/lib/attachments'
import { useMcpServers } from '@/lib/mcp/mcpServerStorage'
import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'
import {
  type SelectedTextData,
  selectedTextStorage,
} from '@/lib/selected-text/selectedTextStorage'
import { cn } from '@/lib/utils'
import type { ChatMode, PermissionMode } from '@/modules/chat/chat-types'
import { toSidepanelFileParts } from '@/modules/chat-actions/chat-send-params'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'
import { ChatAttachedTabs } from './ChatAttachedTabs'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatModeToggle } from './ChatModeToggle'
import { ChatSelectedText } from './ChatSelectedText'
import { getSelectedTextActionPrompt } from './selected-text-actions'

export interface ChatFooterProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void
  input: string
  onInputChange: (value: string) => void
  onSubmit: (e: FormEvent, files?: FileUIPart[]) => boolean | undefined
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  onStop: () => void
  sendDisabled?: boolean
  selectedProvider?: Provider | null
  attachedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  onRemoveTab: (tabId?: number) => void
  attachments?: StagedAttachment[]
  onAttachmentsChange?: (attachments: StagedAttachment[]) => void
}

export const ChatFooter: FC<ChatFooterProps> = ({
  mode,
  onModeChange,
  permissionMode,
  onPermissionModeChange,
  input,
  onInputChange,
  onSubmit,
  status,
  onStop,
  sendDisabled,
  selectedProvider = null,
  attachedTabs,
  onToggleTab,
  onRemoveTab,
  attachments = [],
  onAttachmentsChange,
}) => {
  const { selectedFolder } = useWorkspace()
  const { servers: mcpServers } = useMcpServers()
  const chatInputRef = useRef<ChatInputHandle>(null)
  const [selectionMap, setSelectionMap] = useState<
    Record<string, SelectedTextData>
  >({})
  const [activeTabId, setActiveTabId] = useState<number | undefined>()

  // Track active tab for tab-scoped selection display
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => setActiveTabId(tabs[0]?.id))
    const listener = (activeInfo: { tabId: number }) => {
      setActiveTabId(activeInfo.tabId)
    }
    chrome.tabs.onActivated.addListener(listener)
    return () => chrome.tabs.onActivated.removeListener(listener)
  }, [])

  // Watch selected text storage (per-tab map)
  useEffect(() => {
    selectedTextStorage.getValue().then(setSelectionMap)
    const unwatch = selectedTextStorage.watch(setSelectionMap)
    return () => unwatch()
  }, [])

  const visibleSelectedText = activeTabId
    ? (selectionMap[String(activeTabId)] ?? null)
    : null
  const [isTabMentionOpen, setIsTabMentionOpen] = useState(false)

  useEffect(() => {
    const focusInput = () => {
      const active = document.activeElement
      const isInteractiveElementFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        active instanceof HTMLButtonElement
      if (!isInteractiveElementFocused) {
        chatInputRef.current?.focus()
      }
    }

    if (document.hasFocus()) {
      focusInput()
    }

    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [])

  const managedServers = mcpServers.filter(
    (s) => s.type === 'managed' && s.managedServerName,
  )

  return (
    <footer className="border-border/40 border-t bg-background/80 backdrop-blur-md">
      <ChatAttachedTabs tabs={attachedTabs} onRemoveTab={onRemoveTab} />
      {visibleSelectedText && (
        <ChatSelectedText
          selectedText={visibleSelectedText}
          onAction={(action) => {
            const random = crypto.getRandomValues(new Uint8Array(8))
            const nonce = Array.from(random, (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('')
            onInputChange(
              getSelectedTextActionPrompt(action, visibleSelectedText, nonce),
            )
            chatInputRef.current?.focus()
          }}
          onDismiss={() => {
            if (!activeTabId) return
            void sendRuntimeMessage(RuntimeMessageType.removeSelectedText, {
              tabId: activeTabId,
            })
          }}
        />
      )}

      <div className="p-3">
        <div className="mb-3">
          <ProcessingDisclosure provider={selectedProvider} compact />
        </div>
        <div className="flex items-center gap-2">
          <ChatModeToggle mode={mode} onModeChange={onModeChange} />

          <label className="sr-only" htmlFor="permission-mode">
            Permission mode
          </label>
          <select
            id="permission-mode"
            aria-label="Permission mode"
            title={
              mode === 'chat'
                ? 'Chat task mode always uses Read-only permissions.'
                : 'Choose what BrowserOS can do for this task.'
            }
            value={mode === 'chat' ? 'read-only' : permissionMode}
            onChange={(event) =>
              onPermissionModeChange(event.target.value as PermissionMode)
            }
            className="h-8 rounded-lg border border-border/50 bg-background px-2 text-muted-foreground text-xs"
          >
            <option value="guard">Guard</option>
            <option value="read-only">Read-only</option>
            <option value="full" disabled>
              Full access (unavailable)
            </option>
          </select>

          <div className="h-4 w-px bg-border/50" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => chatInputRef.current?.toggleTabMention()}
              data-tab-mention-trigger
              data-state={isTabMentionOpen ? 'open' : 'closed'}
              aria-expanded={isTabMentionOpen}
              aria-haspopup="dialog"
              className="flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
              title="Attach tabs (@)"
            >
              <Layers className="h-4 w-4" />
              {attachedTabs.length > 0 && (
                <span className="font-medium text-[var(--accent-orange)] text-xs">
                  {attachedTabs.length}
                </span>
              )}
              <ChevronDown className="h-3 w-3" />
            </button>

            <WorkspaceSelector side="top">
              <button
                type="button"
                className={cn(
                  'flex cursor-pointer items-center gap-1 rounded-lg p-1.5 transition-colors hover:bg-muted/50 data-[state=open]:bg-accent',
                  selectedFolder
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title={
                  selectedFolder
                    ? selectedFolder.name
                    : 'Select workspace folder'
                }
              >
                <div className="relative">
                  <Folder className="h-4 w-4" />
                  {selectedFolder && (
                    <div className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-orange)]" />
                  )}
                </div>
                <ChevronDown className="h-3 w-3" />
              </button>
            </WorkspaceSelector>

            <AppSelector side="top">
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
                title="Connect apps"
              >
                {managedServers.length > 0 ? (
                  <>
                    <div className="flex items-center -space-x-1">
                      {managedServers.slice(0, 3).map((s) => (
                        <div
                          key={s.id}
                          className="rounded-full ring-2 ring-background"
                        >
                          <McpServerIcon
                            serverName={s.managedServerName ?? ''}
                            size={14}
                          />
                        </div>
                      ))}
                    </div>
                    {managedServers.length > 3 && (
                      <span className="font-medium text-xs">
                        +{managedServers.length - 3}
                      </span>
                    )}
                  </>
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                <ChevronDown className="h-3 w-3" />
              </button>
            </AppSelector>
          </div>
        </div>

        <ChatInput
          input={input}
          status={status}
          mode={mode}
          sendDisabled={sendDisabled}
          onInputChange={onInputChange}
          onSubmit={(event) =>
            onSubmit(event, toSidepanelFileParts(attachments))
          }
          onStop={onStop}
          selectedTabs={attachedTabs}
          onToggleTab={onToggleTab}
          onTabMentionOpenChange={setIsTabMentionOpen}
          attachments={attachments}
          onAttachmentsChange={onAttachmentsChange}
          ref={chatInputRef}
        />
      </div>
    </footer>
  )
}
