import { ArrowRight, Search, Sparkles } from 'lucide-react'
import { type FC, type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { NoProviderNotice } from '@/components/chat/NoProviderNotice'
import { Feature } from '@/lib/browseros/capabilities'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { useCapabilities } from '@/modules/browseros/capabilities.hooks'
import { stagePendingHomeMessage } from '@/modules/chat/pending-home-message'
import { useChatTargetSelection } from '@/modules/chat/use-chat-target-selection'
import { ImportDataHint } from '@/screens/newtab/index/ImportDataHint'
import { useShowImportHint } from '@/screens/newtab/index/import-hint.hooks'
import { RecentSites } from '@/screens/newtab/index/RecentSites'
import { ScheduleResults } from '@/screens/newtab/index/ScheduleResults'
import {
  ConversationInput,
  type ConversationInputSendInput,
} from './ConversationInput'
import { resolveHomeLlmRoutingMode } from './home-compose.helpers'
import { resolveHomeSearchUrl } from './home-search'

export const AgentCommandHome: FC = () => {
  const navigate = useNavigate()
  const showImportHint = useShowImportHint()
  const { supports, isLoading: capabilitiesLoading } = useCapabilities()
  const supportsInlineChat = supports(Feature.NEWTAB_CHAT_SUPPORT)
  const llmRoutingMode = resolveHomeLlmRoutingMode({
    capabilitiesLoading,
    supportsInlineChat,
  })
  // Shared selection: the picker is derived from the persisted selection (kept in
  // sync with the sidebar and settings), so a third-party agent chosen here is
  // restored on load and falls back to the default LLM provider while agents load.
  const {
    chatTargets,
    providerOptions,
    selectedProvider,
    selectProvider,
    selectChatTarget,
    hasAnyTarget,
    isSettled,
  } = useChatTargetSelection()
  const waitingForLlmCapabilities =
    selectedProvider?.kind === 'llm' && llmRoutingMode === 'wait'
  const noTarget = isSettled && !hasAnyTarget
  // This composer does not run through the chat session hook, so it carries its
  // own copy of the refused-send state.
  const [sendAttemptBlocked, setSendAttemptBlocked] = useState(false)
  const [mode, setMode] = useState<'ask' | 'search'>('ask')
  const [searchQuery, setSearchQuery] = useState('')
  const sendBlocked = sendAttemptBlocked && noTarget

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const url = resolveHomeSearchUrl(searchQuery)
    if (url) void chrome.tabs.create({ url })
  }

  const handleSend = async (input: ConversationInputSendInput) => {
    if (!selectedProvider) {
      // Answer the send rather than dropping it. This used to return silently,
      // which was invisible only because a provider was always present.
      setSendAttemptBlocked(true)
      return
    }
    if (selectedProvider.kind === 'llm' && llmRoutingMode === 'wait') return
    const target = chatTargets.find(
      (entry) =>
        entry.kind === selectedProvider.kind &&
        entry.id === selectedProvider.id,
    )
    if (!target) return
    await selectChatTarget(target)
    if (target.kind === 'llm' && llmRoutingMode === 'sidepanel') {
      const action = createBrowserOSAction({
        mode: 'chat',
        message: input.text,
        tabs: input.selectedTabs,
      })
      await openSidePanelWithSearch('open', {
        query: input.text,
        mode: 'chat',
        action,
      })
      return
    }
    const search = new URLSearchParams({ q: input.text, mode: 'agent' })
    if (input.attachments.length > 0) {
      search.set(
        'handoff',
        stagePendingHomeMessage({
          text: input.text,
          attachments: input.attachments,
        }),
      )
    }
    const tabIds = input.selectedTabs
      .map((tab) => tab.id)
      .filter((id): id is number => id !== undefined)
    if (tabIds.length > 0) search.set('tabs', tabIds.join(','))
    navigate(`/home/chat?${search.toString()}`)
  }

  return (
    <div className="aster-home min-h-screen px-4 py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="flex flex-col items-center gap-5 pt-[max(10vh,24px)] text-center">
          <div className="flex items-center gap-2 rounded-full border border-[var(--aster-line)] bg-[var(--aster-card)] px-3 py-1.5 font-medium text-[var(--aster-muted)] text-xs shadow-sm">
            <span className="aster-mark" aria-hidden="true">
              ✳
            </span>
            ASTER BROWSER
          </div>
          <div className="space-y-3">
            <h1 className="font-semibold text-[clamp(2.25rem,4.5vw,3.5rem)] text-[var(--aster-ink)] leading-[1.08] tracking-[-0.04em] [text-wrap:balance]">
              A clearer way to{' '}
              <span className="font-medium text-[var(--aster-accent)] italic">
                browse
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-[var(--aster-muted)] text-sm leading-6 [text-wrap:pretty]">
              Search the web or bring an AI agent into your workflow.
            </p>
          </div>

          <div className="w-full max-w-3xl space-y-3">
            <fieldset className="mx-auto flex w-fit items-center gap-1 rounded-full border border-[var(--aster-line)] bg-[var(--aster-card)] p-1 shadow-sm">
              <legend className="sr-only">Home mode</legend>
              <button
                type="button"
                aria-pressed={mode === 'search'}
                onClick={() => setMode('search')}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${mode === 'search' ? 'bg-[var(--aster-ink)] text-white' : 'text-[var(--aster-muted)] hover:text-[var(--aster-ink)]'}`}
              >
                <Search className="size-4" />
                Search
              </button>
              <button
                type="button"
                aria-pressed={mode === 'ask'}
                onClick={() => setMode('ask')}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${mode === 'ask' ? 'bg-[var(--aster-ink)] text-white' : 'text-[var(--aster-muted)] hover:text-[var(--aster-ink)]'}`}
              >
                <Sparkles className="size-4" />
                Ask AI
              </button>
            </fieldset>
            {mode === 'search' ? (
              <form
                onSubmit={handleSearch}
                className="flex items-center gap-3 rounded-[1.35rem] border border-[var(--aster-line)] bg-[var(--aster-card)] p-3 shadow-[0_12px_35px_rgba(27,43,40,0.08)] focus-within:border-[var(--aster-accent)]/60"
              >
                <Search className="ml-2 size-5 shrink-0 text-[var(--aster-muted)]" />
                <input
                  value={searchQuery}
                  onChange={(event) =>
                    setSearchQuery(event.currentTarget.value)
                  }
                  aria-label="Search the web or enter an address"
                  placeholder="Search the web or enter an address"
                  className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--aster-ink)] outline-none placeholder:text-[var(--aster-muted)]/70"
                />
                <button
                  type="submit"
                  disabled={!searchQuery.trim()}
                  aria-label="Search"
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--aster-accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <ArrowRight className="size-5" />
                </button>
              </form>
            ) : (
              <ConversationInput
                variant="home"
                providers={providerOptions}
                selectedProvider={selectedProvider}
                onSelectProvider={selectProvider}
                onSend={handleSend}
                streaming={false}
                // Stays usable with nothing connected so the task someone came to
                // write survives the trip to provider setup. Only a genuinely
                // pending load disables it.
                disabled={
                  waitingForLlmCapabilities || (!selectedProvider && !noTarget)
                }
                attachmentsEnabled={selectedProvider?.kind === 'acp'}
                placeholder={
                  selectedProvider
                    ? `Ask ${selectedProvider.name} to handle a task...`
                    : noTarget
                      ? 'Describe a task...'
                      : 'Loading providers...'
                }
              />
            )}
            {mode === 'ask' && noTarget && (
              <NoProviderNotice
                blocked={sendBlocked}
                variant="inline"
                className="text-left"
              />
            )}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 pb-12">
          <RecentSites />
          <ScheduleResults />
        </div>
      </div>

      {showImportHint ? <ImportDataHint /> : null}
    </div>
  )
}
