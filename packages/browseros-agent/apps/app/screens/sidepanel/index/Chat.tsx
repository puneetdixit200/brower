import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { HumanInterventionResume } from '@/components/chat/HumanInterventionResume'
import { NoProviderNotice } from '@/components/chat/NoProviderNotice'
import type { StagedAttachment } from '@/lib/attachments'
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
import { resumeHumanIntervention } from '@/modules/chat/human-intervention-client'
import {
  buildChatSendParams,
  toSidepanelFileParts,
} from '@/modules/chat-actions/chat-send-params'
import { useJtbdPopup } from '@/modules/jtbd-popup/jtbd-popup.hooks'
import { buildChatErrorProps } from './Chat.helpers'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatError } from './ChatError'
import { ChatFooter } from './ChatFooter'
import { ChatMessages } from './ChatMessages'
import { hasPendingHumanWait } from './getMessageSegments'
import { HumanLoginHandoff } from './HumanLoginHandoff'
import {
  queryContinuationTabs,
  sendContinuationForConversation,
} from './human-login-handoff'
import { IncognitoNotice } from './IncognitoNotice'
import {
  canDrainPromptQueue,
  clearPromptQueue,
  dispatchNextPrompt,
  enqueuePrompt,
  isPromptQueueRetryCurrent,
  MAX_QUEUED_PROMPTS,
  promptQueueForConversation,
  removeQueuedPrompt,
  replaceConversationPromptQueue,
  retryConversationPromptQueue,
} from './prompt-queue'
import { ResearchSupportConsent } from './ResearchSupportConsent'
import { prepareSourceResearch } from './research-request'

/**
 * @public
 */
export const Chat = () => {
  const {
    mode,
    setMode,
    permissionMode,
    setPermissionMode,
    messages,
    sendMessage,
    respondToToolApproval,
    status,
    stop,
    stopError,
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
    conversationId,
    serverRunId,
    humanInterventionWait,
    resumeDetectedHumanIntervention,
    startFreshConversationFromInterruption,
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
  const [queuedPromptsByConversation, setQueuedPromptsByConversation] =
    useState<Record<string, string[]>>({})
  const queuedPromptsRef = useRef(queuedPromptsByConversation)
  const queuedPrompts = promptQueueForConversation(
    queuedPromptsByConversation,
    conversationId,
  )
  const queueGeneration = useRef(0)
  const queueAwaitingRun = useRef(false)
  const [attachedTabs, setAttachedTabs] = useState<chrome.tabs.Tab[]>([])
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [assessResearchSupport, setAssessResearchSupport] = useState(false)
  const selectedProviderId = selectedProvider?.id
  const previousSelectedProviderId = useRef(selectedProviderId)
  const [draftOwnerTabId, setDraftOwnerTabId] = useState<number | undefined>()
  const [draftIncognito, setDraftIncognito] = useState(true)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [mounted, setMounted] = useState(false)
  queuedPromptsRef.current = queuedPromptsByConversation

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (previousSelectedProviderId.current !== selectedProviderId) {
      previousSelectedProviderId.current = selectedProviderId
      setAssessResearchSupport(false)
    }
  }, [selectedProviderId])

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

  const previousQueueConversationId = useRef(conversationId)
  useEffect(() => {
    if (previousQueueConversationId.current !== conversationId) {
      previousQueueConversationId.current = conversationId
      queueAwaitingRun.current = false
    }
  }, [conversationId])

  // An explicit user queue is ephemeral and bounded to its conversation. No
  // hidden browser context, credentials, or automatic tool replay is stored.
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      queueAwaitingRun.current = false
      return
    }
    if (
      !canDrainPromptQueue(
        status,
        canSend,
        queuedPrompts.length,
        queueAwaitingRun.current,
      )
    ) {
      return
    }
    queueAwaitingRun.current = true
    const attempt = dispatchNextPrompt(queuedPrompts, (text) =>
      sendMessage({ text }),
    )
    if (attempt.accepted) {
      const nextQueues = replaceConversationPromptQueue(
        queuedPromptsRef.current,
        conversationId,
        attempt.remaining,
      )
      queuedPromptsRef.current = nextQueues
      setQueuedPromptsByConversation(nextQueues)
    } else {
      queueAwaitingRun.current = false
      // Refusal can be transient without changing chat status. Retry while
      // the same head prompt remains queued; the effect cleanup cancels this
      // retry when status, sendability, or the queue changes.
      const scheduledPrompt = queuedPrompts[0]
      const scheduledGeneration = queueGeneration.current
      const retryTimer = window.setTimeout(() => {
        if (
          scheduledPrompt &&
          isPromptQueueRetryCurrent(
            promptQueueForConversation(
              queuedPromptsRef.current,
              conversationId,
            ),
            scheduledPrompt,
            scheduledGeneration,
            queueGeneration.current,
          )
        ) {
          const nextQueues = retryConversationPromptQueue(
            queuedPromptsRef.current,
            conversationId,
          )
          if (nextQueues !== queuedPromptsRef.current) {
            queuedPromptsRef.current = nextQueues
            setQueuedPromptsByConversation(nextQueues)
          }
        }
      }, 250)
      return () => window.clearTimeout(retryTimer)
    }
  }, [status, canSend, queuedPrompts, sendMessage, conversationId])

  const queueCurrentPrompt = () => {
    if (queuedPrompts.length >= MAX_QUEUED_PROMPTS) return
    const next = enqueuePrompt(queuedPrompts, input)
    if (next === queuedPrompts) return
    const nextQueues = replaceConversationPromptQueue(
      queuedPromptsRef.current,
      conversationId,
      next,
    )
    queuedPromptsRef.current = nextQueues
    setQueuedPromptsByConversation(nextQueues)
    setInput('')
  }

  const clearQueuedPrompts = () => {
    const cleared = clearPromptQueue(queueGeneration.current)
    queueGeneration.current = cleared.generation
    const nextQueues = replaceConversationPromptQueue(
      queuedPromptsRef.current,
      conversationId,
      cleared.queue,
    )
    queuedPromptsRef.current = nextQueues
    queueAwaitingRun.current = false
    setQueuedPromptsByConversation(nextQueues)
  }

  const removeQueuedPromptAt = (index: number) => {
    const currentQueue = promptQueueForConversation(
      queuedPromptsRef.current,
      conversationId,
    )
    const next = removeQueuedPrompt(currentQueue, index)
    if (next === currentQueue) return
    queueGeneration.current += 1
    queueAwaitingRun.current = false
    const nextQueues = replaceConversationPromptQueue(
      queuedPromptsRef.current,
      conversationId,
      next,
    )
    queuedPromptsRef.current = nextQueues
    setQueuedPromptsByConversation(nextQueues)
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
    clearQueuedPrompts()
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

  const executeMessage = (customMessageText?: string): boolean => {
    const messageText = customMessageText ? customMessageText : input.trim()
    if (!messageText) return false
    recordMessageSent()
    const sent = sendMessage(
      buildChatSendParams({
        text: messageText,
        mode,
        attachedTabs,
        files: toSidepanelFileParts(attachments),
      }),
    )

    // Keep the draft when the send did not happen. Clearing unconditionally
    // threw away what the user typed whenever sendMessage refused, which is
    // every send made with nothing connected.
    if (!sent) return false
    setInput('')
    setAttachedTabs([])
    setAttachments([])
    return true
  }

  const researchWithSources = () => {
    const request = prepareSourceResearch({
      question: input,
      tabs: attachedTabs,
      mode,
    })
    if (!request || !canSend || status !== 'ready') return
    const sent = sendMessage({
      text: request,
      action: createBrowserOSAction({
        mode: 'agent',
        message: request,
        tabs: attachedTabs,
        assessResearchSupport:
          selectedProvider?.kind === 'llm' && assessResearchSupport,
      }),
    })
    if (sent) {
      setInput('')
      setAttachedTabs([])
      setAssessResearchSupport(false)
    }
  }

  const handleSubmit = (e: React.FormEvent): boolean => {
    e.preventDefault()
    if (messages.length === 0) {
      track(SIDEPANEL_AI_TRIGGERED_EVENT, {
        mode,
        tabs_count: attachedTabs.length,
      })
    }
    return executeMessage()
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

  const resumeHumanWait = (requestId: string) =>
    serverRunId
      ? resumeHumanIntervention({
          conversationId,
          runId: serverRunId,
          requestId,
        })
      : Promise.resolve(false)

  const queuedPromptRows = queuedPrompts.map((prompt, index) => ({
    prompt,
    index,
    key: `${prompt}-${
      queuedPrompts.slice(0, index).filter((previous) => previous === prompt)
        .length
    }`,
  }))

  return (
    <>
      {stopError && (
        <div role="alert" className="rounded-lg border p-3 text-sm">
          {stopError}
        </div>
      )}
      <main className="mt-4 flex h-full flex-1 flex-col space-y-4 overflow-y-auto">
        <HumanInterventionResume
          wait={
            humanInterventionWait?.phase === 'waiting' &&
            hasPendingHumanWait(messages)
              ? null
              : humanInterventionWait
          }
          onResume={resumeDetectedHumanIntervention}
          onStartFresh={startFreshConversationFromInterruption}
        />
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
            onResumeHumanWait={resumeHumanWait}
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

      {(status === 'streaming' ||
        status === 'submitted' ||
        queuedPrompts.length > 0) && (
        <section
          className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs"
          aria-label="Queued agent prompts"
        >
          <span>
            {queuedPrompts.length} queued prompts (maximum {MAX_QUEUED_PROMPTS},
            this chat only)
          </span>
          {queuedPrompts.length > 0 && (
            <ol className="w-full space-y-1">
              {queuedPromptRows.map(({ prompt, index, key }) => (
                <li key={key} className="flex min-w-0 items-start gap-2">
                  <span className="min-w-0 flex-1 break-words">
                    {index + 1}. {prompt}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border px-2 py-1"
                    aria-label={`Remove queued prompt ${index + 1}`}
                    onClick={() => removeQueuedPromptAt(index)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          {(status === 'streaming' || status === 'submitted') && (
            <button
              type="button"
              disabled={
                !input.trim() || queuedPrompts.length >= MAX_QUEUED_PROMPTS
              }
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
              onClick={clearQueuedPrompts}
            >
              Clear queue
            </button>
          )}
        </section>
      )}
      {isIncognito && <IncognitoNotice />}
      {mode === 'agent' && input.trim() && (
        <div className="px-3 text-xs">
          <button
            type="button"
            disabled={!canSend || status !== 'ready'}
            onClick={researchWithSources}
            className="rounded-md border px-2 py-1.5 disabled:opacity-50"
          >
            Research with source URLs
          </button>
          {selectedProvider?.kind === 'llm' && (
            <ResearchSupportConsent
              checked={assessResearchSupport}
              onChange={setAssessResearchSupport}
            />
          )}
          <p className="mt-1 text-muted-foreground">
            Uses selected tabs as source leads. Aster does not independently
            verify every citation; review sources before relying on results.
          </p>
        </div>
      )}
      {mode === 'agent' && (
        <HumanLoginHandoff
          key={conversationId}
          onStop={handleStop}
          onContinue={async (prompt) => {
            return sendContinuationForConversation(
              conversationId,
              () => conversationIdRef.current,
              async () => {
                const targetTabs = await queryContinuationTabs(
                  attachedTabs,
                  () => chrome.tabs.query({ currentWindow: true }),
                )
                return targetTabs.length ? targetTabs : null
              },
              (targetTabs) => {
                const action = createBrowserOSAction({
                  mode: 'agent',
                  message: prompt,
                  tabs: targetTabs,
                  contextPrivacy: 'human-login-continuation',
                })
                return sendMessage({ text: prompt, action })
              },
            )
          }}
          attachedTabs={attachedTabs}
        />
      )}

      <ChatFooter
        mode={mode}
        onModeChange={handleModeChange}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        status={status}
        onStop={handleStop}
        sendDisabled={!canSend}
        selectedProvider={selectedProvider}
        attachedTabs={attachedTabs}
        onToggleTab={toggleTabSelection}
        onRemoveTab={removeTab}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
      />
    </>
  )
}
