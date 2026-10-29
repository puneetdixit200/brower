import type { UIMessage } from 'ai'
import { Bot } from 'lucide-react'
import { type FC, Fragment } from 'react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import type { ChatAction } from '@/lib/chat-actions/types'
import { ChatMessageActions } from './ChatMessageActions'
import { ConnectAppCard } from './ConnectAppCard'
import { getMessageSegments } from './getMessageSegments'
import { JtbdPopup } from './JtbdPopup'
import { ResearchSupportAssessment } from './ResearchSupportAssessment'
import {
  getResearchSourceLedger,
  RESEARCH_LEDGER_LIMITATION,
} from './research-source-ledger'
import { ScheduleSuggestionCard } from './ScheduleSuggestionCard'
import { ToolBatch } from './ToolBatch'
import { UserActionMessage } from './UserActionMessage'

export interface ChatMessagesProps {
  messages: UIMessage[]
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  getActionForMessage?: (message: UIMessage) => ChatAction | undefined
  liked: Record<string, boolean>
  onClickLike: (messageId: string) => void
  disliked: Record<string, boolean>
  onClickDislike: (messageId: string, comment?: string) => void
  onToolApprovalResponse: (input: { id: string; approved: boolean }) => void
  showJtbdPopup: boolean
  showDontShowAgain: boolean
  onTakeSurvey: (opts?: { dontShowAgain?: boolean }) => void
  onDismissJtbdPopup: (dontShowAgain: boolean) => void
}

export const ChatMessages: FC<ChatMessagesProps> = ({
  messages,
  status,
  getActionForMessage,
  liked,
  disliked,
  onClickLike,
  onClickDislike,
  onToolApprovalResponse,
  showJtbdPopup,
  showDontShowAgain,
  onTakeSurvey,
  onDismissJtbdPopup,
}) => {
  const isStreaming = status === 'streaming' || status === 'submitted'
  const researchLedger = getResearchSourceLedger(messages, isStreaming)

  return (
    <>
      <Conversation className="ph-mask">
        <ConversationContent>
          {messages.map((message, messageIndex) => {
            const action = getActionForMessage?.(message)
            const isLastMessage = messageIndex === messages.length - 1
            const segments = getMessageSegments(
              message,
              isLastMessage,
              isStreaming,
            )
            const toolBatches = segments.filter((s) => s.type === 'tool-batch')
            const lastToolBatchKey = toolBatches[toolBatches.length - 1]?.key

            const messageText = segments
              ?.filter((each) => each.type === 'text')
              ?.map((each) => each.text)
              ?.join('\n\n')
            const supportPart = message.parts.find(
              (part) => part.type === 'data-a11Support',
            ) as
              | {
                  data?: {
                    status?: string
                    assessments?: Array<{
                      claim?: string
                      support?: string
                      explanation?: string
                    }>
                  }
                }
              | undefined

            const likeAction = () => onClickLike(message.id)
            const dislikeAction = (comment?: string) =>
              onClickDislike(message.id, comment)

            return (
              <Fragment key={message.id}>
                <Message from={message.role}>
                  <MessageContent>
                    {action ? (
                      <UserActionMessage action={action} />
                    ) : (
                      segments.map((segment) => {
                        switch (segment.type) {
                          case 'text':
                            return (
                              <MessageResponse key={segment.key}>
                                {segment.text}
                              </MessageResponse>
                            )
                          case 'reasoning':
                            return (
                              <Reasoning
                                key={segment.key}
                                className="w-full"
                                isStreaming={segment.isStreaming}
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>
                                  {segment.text}
                                </ReasoningContent>
                              </Reasoning>
                            )
                          case 'tool-batch':
                            return (
                              <ToolBatch
                                key={segment.key}
                                tools={segment.tools}
                                isLastBatch={segment.key === lastToolBatchKey}
                                isLastMessage={isLastMessage}
                                isStreaming={isStreaming}
                                onToolApprovalResponse={onToolApprovalResponse}
                              />
                            )
                          case 'nudge':
                            return segment.nudgeType ===
                              'schedule_suggestion' ? (
                              <ScheduleSuggestionCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            ) : (
                              <ConnectAppCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            )
                          default:
                            return null
                        }
                      })
                    )}
                    {researchLedger?.answerMessageId === message.id && (
                      <aside
                        aria-label="Source URL checks"
                        className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs"
                      >
                        <h3 className="font-medium">Source URL checks</h3>
                        <p className="mt-1 text-muted-foreground">
                          {RESEARCH_LEDGER_LIMITATION}
                        </p>
                        {researchLedger.unattributedQuoteCount > 0 && (
                          <p
                            role="status"
                            className="mt-2 text-muted-foreground"
                          >
                            {researchLedger.unattributedQuoteCount} quote(s) had
                            multiple nearby source URLs and were not attributed
                            to any page. Review those citations manually.
                          </p>
                        )}
                        {researchLedger.entries.length > 0 ? (
                          <ul className="mt-2 space-y-1">
                            {researchLedger.entries.map((entry) => (
                              <li
                                className="break-all"
                                key={`${entry.status}:${entry.url}`}
                              >
                                <span className="font-medium">
                                  {entry.status}
                                </span>
                                {entry.observedBy.length > 0 && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    · observed via {entry.observedBy.join(', ')}
                                  </span>
                                )}
                                <span className="text-muted-foreground">
                                  {' '}
                                  ·{' '}
                                </span>
                                <span>{entry.displayUrl}</span>
                                {entry.quoteChecks.map((check) => (
                                  <p
                                    className="mt-1 text-muted-foreground"
                                    key={`${entry.url}:quote:${check.sourceOffset}`}
                                  >
                                    <span className="font-medium">
                                      Exact quote text{' '}
                                      {check.found ? 'found' : 'not found'}
                                    </span>{' '}
                                    in a successful read from this URL: “
                                    {check.quote}”
                                  </p>
                                ))}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-muted-foreground">
                            No HTTPS citation URLs or attached seed URLs were
                            found in this research answer.
                          </p>
                        )}
                        <p className="mt-2 text-muted-foreground">
                          Exact text presence does not prove a quote supports
                          its claim or that the claim is true.
                        </p>
                      </aside>
                    )}
                    {message.role === 'assistant' && supportPart?.data && (
                      <ResearchSupportAssessment data={supportPart.data} />
                    )}
                  </MessageContent>
                </Message>
                {message.role === 'assistant' &&
                (!isLastMessage || !isStreaming) ? (
                  <ChatMessageActions
                    messageId={message.id}
                    messageText={messageText}
                    liked={liked[message.id] ?? false}
                    disliked={disliked[message.id] ?? false}
                    onClickLike={likeAction}
                    onClickDislike={dislikeAction}
                  />
                ) : null}
              </Fragment>
            )
          })}
          {showJtbdPopup && (
            <JtbdPopup
              onTakeSurvey={onTakeSurvey}
              onDismiss={onDismissJtbdPopup}
              showDontShowAgain={showDontShowAgain}
            />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {isStreaming && (
        <div className="flex animate-fadeInUp gap-2 px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-orange)] text-white">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-center gap-1 rounded-xl rounded-tl-none border border-border/50 bg-card px-3 py-2.5 shadow-sm">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-orange)] [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-orange)] [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent-orange)]" />
          </div>
        </div>
      )}
      <div />
    </>
  )
}
