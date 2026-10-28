import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NoProviderNotice } from '@/components/chat/NoProviderNotice'
import { isIncognitoWindow } from '@/lib/browseros/incognito'
import { panelTabIdFromUrl } from '@/lib/browseros/panelTab'
import { sidePanelDraftsStorage } from '@/lib/browseros/sidePanelDraftStorage'
import {
  getSidePanelDraft,
  removeSidePanelDraft,
  type SidePanelDraft,
  setSidePanelDraft,
} from '@/lib/browseros/sidepanelDrafts'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import {
  SIDEPANEL_AI_TRIGGERED_EVENT,
  SIDEPANEL_MODE_CHANGED_EVENT,
  SIDEPANEL_STOP_CLICKED_EVENT,
  SIDEPANEL_SUGGESTION_CLICKED_EVENT,
  SIDEPANEL_TAB_REMOVED_EVENT,
  SIDEPANEL_TAB_TOGGLED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import type { ChatMode } from '@/modules/chat/chat-types'
import { useJtbdPopup } from '@/modules/jtbd-popup/jtbd-popup.hooks'
import { buildChatErrorProps } from './Chat.helpers'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatError } from './ChatError'
import { ChatFooter } from './ChatFooter'
import { ChatMessages } from './ChatMessages'
import { IncognitoNotice } from './IncognitoNotice'
import { HumanLoginHandoff } from './HumanLoginHandoff'

/**
 * @public
 */
export const Chat = () => {
  const {
    mode,
    setMode,
    messages,
    sendMessage,
    respondToToolApproval,
    status,
    stop,
    agentUrlError,
    chatError,
    canSend,
    selectedProvider,
    getActionForMessage,
    liked,
    onClickLike,
    disliked,
    onClickDislike,
    isRestoringConversation,
    isIncognito,
    retryLastTurn,
    hasAnyTarget,
    isSettled,
    sendBlocked,
  } = useChatSessionContext()

  const {
    popupVisible,
    showDontShowAgain,
    recordMessageSent,
    triggerIfEligible,
    onTakeSurvey,
    onDismiss: onDismissJtbdPopup,
  } = useJtbdPopup()

  const [input, setInput] = useState('')
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>([])
  const queueAwaitingRun = useRef(false)
  const [attachedTabs, setAttachedTabs] = useState<chrome.tabs.Tab[]>([])
  const [draftOwnerTabId, setDraftOwnerTabId] = useState<number | undefined>()
  const [draftIncognito, setDraftIncognito] = useState(true)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const restoreDraft = async () => {
      const ownerTabId = panelTabIdFromUrl(location.href)
      const incognito = await isIncognitoWindow()
      const currentTab =
        ownerTabId !== undefined
          ? await chrome.tabs.get(ownerTabId).catch(() => undefined)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
      const currentTabs = currentTab?.url?.startsWith('http')
        ? [currentTab]
        : []
      let draft: SidePanelDraft | undefined
      if (ownerTabId !== undefined && !incognito) {
        const drafts = await sidePanelDraftsStorage.getValue()
        draft = getSidePanelDraft(drafts, ownerTabId)
      }

      let restoredTabs = currentTabs
      if (draft) {
        restoredTabs = (
          await Promise.all(
            draft.attachedTabIds.map((tabId) =>
              chrome.tabs.get(tabId).catch(() => undefined),
            ),
          )
        ).filter((tab): tab is chrome.tabs.Tab =>
          Boolean(tab?.url?.startsWith('http')),
        )
        if (draft.input) setInput(draft.input)
      }

      if (cancelled) return
      setDraftOwnerTabId(ownerTabId)
      setDraftIncognito(incognito)
      setAttachedTabs(restoredTabs)
      setDraftLoaded(true)
    }

    restoreDraft().catch(() => {
      if (!cancelled) setDraftLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!draftLoaded || draftIncognito || draftOwnerTabId === undefined) return
    const persistDraft = async () => {
      const drafts = await sidePanelDraftsStorage.getValue()
      const attachedTabIds = attachedTabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => tabId !== undefined)
      const hasDraft =
        input.length > 0 ||
        attachedTabIds.some((tabId) => tabId !== draftOwnerTabId)
      const nextDrafts = hasDraft
        ? setSidePanelDraft(drafts, draftOwnerTabId, {
            input,
            attachedTabIds,
            updatedAt: Date.now(),
          })
        : removeSidePanelDraft(drafts, draftOwnerTabId)
      await sidePanelDraftsStorage.setValue(nextDrafts)
    }
    void persistDraft().catch(() => undefined)
  }, [input, attachedTabs, draftLoaded, draftIncognito, draftOwnerTabId])

  // An explicit user queue is ephemeral and bounded. No hidden browser
  // context, credentials, or automatic tool replay is stored with a prompt.
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      queueAwaitingRun.current = false
      return
    }
    if (
      status !== 'ready' ||
      !canSend ||
      queuedPrompts.length === 0 ||
      queueAwaitingRun.current
    ) {
      return
    }
    queueAwaitingRun.current = true
    const sent = sendMessage({ text: queuedPrompts[0] })
    if (sent) {
      setQueuedPrompts((previous) => previous.slice(1))
    } else {
      queueAwaitingRun.current = false
    }
  }, [status, canSend, queuedPrompts, sendMessage])

  const queueCurrentPrompt = () => {
    const value = input.trim()
    if (!value || queuedPrompts.length >= 5) return
    setQueuedPrompts((previous) => [...previous, value])
    setInput('')
  }

  // Trigger JTBD popup when AI finishes responding
  const previousChatStatus = useRef(status)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only trigger on status change
  useEffect(() => {
    const aiWasProcessing =
      previousChatStatus.current === 'streaming' ||
      previousChatStatus.current === 'submitted'
    const aiJustFinished = aiWasProcessing && status === 'ready'

    if (aiJustFinished && messages.length > 0) {
      triggerIfEligible()
    }
    previousChatStatus.current = status
  }, [status])

  const handleModeChange = (newMode: ChatMode) => {
    track(SIDEPANEL_MODE_CHANGED_EVENT, { from: mode, to: newMode })
    setMode(newMode)
  }

  const handleStop = () => {
    track(SIDEPANEL_STOP_CLICKED_EVENT)
    // Stop is definitive, not a signal to start the next queued action.
    setQueuedPrompts([])
    queueAwaitingRun.current = false
    stop()
  }

  const toggleTabSelection = (tab: chrome.tabs.Tab) => {
    setAttachedTabs((prev) => {
      const isSelected = prev.some((t) => t.id === tab.id)
      track(SIDEPANEL_TAB_TOGGLED_EVENT, {
        action: isSelected ? 'removed' : 'added',
      })
      if (isSelected) {
        return prev.filter((t) => t.id !== tab.id)
      }
      return [...prev, tab]
    })
  }

  const removeTab = (tabId?: number) => {
    track(SIDEPANEL_TAB_REMOVED_EVENT)
    setAttachedTabs((prev) => prev.filter((t) => t.id !== tabId))
  }

  const executeMessage = (customMessageText?: string) => {
    const messageText = customMessageText ? customMessageText : input.trim()
    if (!messageText) return

    recordMessageSent()

    const sent = attachedTabs.length
      ? sendMessage({
          text: messageText,
          action: createBrowserOSAction({
            mode,
            message: messageText,
            tabs: attachedTabs,
          }),
        })
      : sendMessage({ text: messageText })

    // Keep the draft when the send did not happen. Clearing unconditionally
    // threw away what the user typed whenever sendMessage refused, which is
    // every send made with nothing connected.
    if (!sent) return
    setInput('')
    setAttachedTabs([])
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (messages.length === 0) {
      track(SIDEPANEL_AI_TRIGGERED_EVENT, {
        mode,
        tabs_count: attachedTabs.length,
      })
    }
    executeMessage()
  }

  const handleSuggestionClick = (suggestion: string) => {
    track(SIDEPANEL_SUGGESTION_CLICKED_EVENT, { mode })
    executeMessage(suggestion)
  }

  const chatErrorProps = buildChatErrorProps({
    chatError,
    selectedProvider,
    retryLastTurn,
  })

  return (
    <>
      <main className="mt-4 flex h-full flex-1 flex-col space-y-4 overflow-y-auto">
        {isRestoringConversation ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <ChatEmptyState
            mode={mode}
            mounted={mounted}
            onSuggestionClick={handleSuggestionClick}
          />
        ) : (
          <ChatMessages
            messages={messages}
            status={status}
            getActionForMessage={getActionForMessage}
            liked={liked}
            onClickLike={onClickLike}
            disliked={disliked}
            onClickDislike={onClickDislike}
            onToolApprovalResponse={respondToToolApproval}
            showJtbdPopup={popupVisible}
            showDontShowAgain={showDontShowAgain}
            onTakeSurvey={onTakeSurvey}
            onDismissJtbdPopup={onDismissJtbdPopup}
          />
        )}
        {agentUrlError && (
          <ChatError
            error={agentUrlError}
            providerType={selectedProvider?.type}
          />
        )}
        {chatErrorProps && <ChatError {...chatErrorProps} />}
        {isSettled && !hasAnyTarget && (
          <NoProviderNotice blocked={sendBlocked} />
        )}
      </main>

      {(status === 'streaming' || status === 'submitted' || queuedPrompts.length > 0) && (
        <section className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs" aria-label="Queued agent prompts">
          <span>{queuedPrompts.length} queued prompts (maximum 5, this chat only)</span>
          {(status === 'streaming' || status === 'submitted') && (
            <button
              type="button"
              disabled={!input.trim() || queuedPrompts.length >= 5}
              onClick={queueCurrentPrompt}
              className="rounded-md border px-2 py-1 disabled:opacity-50"
            >
              Queue current prompt
            </button>
          )}
          {queuedPrompts.length > 0 && (
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              onClick={() => setQueuedPrompts([])}
            >
              Clear queue
            </button>
          )}
        </section>
      )}
      {isIncognito && <IncognitoNotice />}
      {mode === 'agent' && (
        <HumanLoginHandoff
          onStop={handleStop}
          attachedTabs={attachedTabs}
        />
      )}

      <ChatFooter
        mode={mode}
        onModeChange={handleModeChange}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        status={status}
        onStop={handleStop}
        sendDisabled={!canSend}
        attachedTabs={attachedTabs}
        onToggleTab={toggleTabSelection}
        onRemoveTab={removeTab}
      />
    </>
  )
}
