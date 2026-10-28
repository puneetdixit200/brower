import {
  BotIcon,
  CheckCircle2,
  ChevronDownIcon,
  CircleDashed,
  Clock,
  Loader2,
  ShieldX,
  XCircle,
} from 'lucide-react'
import { type FC, useEffect, useId, useState } from 'react'
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from '@/components/ai-elements/task'
import { Button } from '@/components/ui/button'
import { formatApprovalInput } from './approval-preview'
import type {
  ToolInvocationInfo,
  ToolInvocationState,
} from './getMessageSegments'

export interface ToolBatchProps {
  tools: ToolInvocationInfo[]
  isLastBatch: boolean
  isLastMessage: boolean
  isStreaming: boolean
  onToolApprovalResponse: (input: { id: string; approved: boolean }) => void
}

export function sendToolApprovalResponse(
  onToolApprovalResponse: ToolBatchProps['onToolApprovalResponse'],
  approvalId: string | undefined,
  toolCallId: string,
  approved: boolean,
) {
  onToolApprovalResponse({ id: approvalId ?? toolCallId, approved })
}

export const ToolBatch: FC<ToolBatchProps> = ({
  tools,
  isLastBatch,
  isLastMessage,
  isStreaming,
  onToolApprovalResponse,
}) => {
  const hasPendingApproval = tools.some(
    (tool) => tool.state === 'approval-requested',
  )
  const shouldBeOpen =
    hasPendingApproval || (isLastMessage && isLastBatch && isStreaming)
  const [isOpen, setIsOpen] = useState(shouldBeOpen)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)

  useEffect(() => {
    if (hasPendingApproval) {
      setIsOpen(true)
      return
    }
    if (isLastMessage && !hasUserInteracted) {
      if (isLastBatch) {
        setIsOpen(isStreaming)
      } else {
        setIsOpen(false)
      }
    }
  }, [
    hasPendingApproval,
    isStreaming,
    isLastMessage,
    isLastBatch,
    hasUserInteracted,
  ])

  const completedCount = tools.filter((t) => isToolCompleted(t.state)).length
  const pendingApprovalCount = tools.filter(
    (tool) => tool.state === 'approval-requested',
  ).length
  const triggerTitle = `${completedCount}/${tools.length} actions completed`
  const approvalLabelId = useId()

  const onManualToggle = (newState: boolean) => {
    setHasUserInteracted(true)
    setIsOpen(newState)
  }

  return (
    <Task open={isOpen} onOpenChange={onManualToggle}>
      <TaskTrigger
        title={triggerTitle}
        TriggerIcon={BotIcon}
        aria-label={
          pendingApprovalCount > 0
            ? `${triggerTitle}; ${pendingApprovalCount} ${pendingApprovalCount === 1 ? 'action requires' : 'actions require'} approval`
            : triggerTitle
        }
      >
        <button
          className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
          type="button"
        >
          <BotIcon aria-hidden="true" className="size-4" />
          <span>{triggerTitle}</span>
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </button>
      </TaskTrigger>
      <TaskContent>
        {tools.map((tool) => (
          <div key={tool.toolCallId}>
            <TaskItem className="flex items-center gap-2">
              <ToolStatusIcon state={tool.state} />
              <span className="flex-1">{formatToolName(tool.toolName)}</span>
            </TaskItem>
            {tool.state === 'approval-requested' && tool.approval?.id && (
              <fieldset
                aria-describedby={`${approvalLabelId}-${tool.toolCallId}-description`}
                className="mt-2 ml-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
              >
                <legend
                  className="font-medium text-sm"
                  id={`${approvalLabelId}-${tool.toolCallId}-title`}
                >
                  Review and authorize this action
                </legend>
                <p
                  className="mt-1 text-muted-foreground text-xs"
                  id={`${approvalLabelId}-${tool.toolCallId}-description`}
                >
                  The following is a redacted preview. Deny if the target or
                  side effect is unclear.
                </p>
                {tool.approval.reason && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    {tool.approval.reason}
                  </p>
                )}
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-xs">
                  {formatApprovalInput(tool.input)}
                </pre>
                <p aria-live="polite" className="sr-only" role="status">
                  Approval is required for {formatToolName(tool.toolName)}.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    aria-label={`Approve ${formatToolName(tool.toolName)} action`}
                    onClick={() =>
                      sendToolApprovalResponse(
                        onToolApprovalResponse,
                        tool.approval?.id,
                        tool.toolCallId,
                        true,
                      )
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Deny ${formatToolName(tool.toolName)} action`}
                    onClick={() =>
                      sendToolApprovalResponse(
                        onToolApprovalResponse,
                        tool.approval?.id,
                        tool.toolCallId,
                        false,
                      )
                    }
                  >
                    Deny
                  </Button>
                </div>
              </fieldset>
            )}
          </div>
        ))}
      </TaskContent>
    </Task>
  )
}

const formatToolName = (name: string) => {
  return name
    ?.replace(/_/g, ' ')
    ?.replace(/([a-z])([A-Z])/g, '$1 $2')
    ?.replace(/^./, (s) => s.toUpperCase())
}

const isToolCompleted = (state: ToolInvocationState) =>
  state === 'result' || state === 'output-available'

const isToolInProgress = (state: ToolInvocationState) =>
  state === 'call' || state === 'input-available'

const isToolError = (state: ToolInvocationState) => state === 'output-error'

const isToolDenied = (state: ToolInvocationState) => state === 'output-denied'

const isToolWaitingForApproval = (state: ToolInvocationState) =>
  state === 'approval-requested'

const ToolStatusIcon: FC<{ state: ToolInvocationState }> = ({ state }) => {
  if (isToolCompleted(state)) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  }
  if (isToolWaitingForApproval(state)) {
    return <Clock className="h-3.5 w-3.5 text-yellow-500" />
  }
  if (isToolDenied(state)) {
    return <ShieldX className="h-3.5 w-3.5 text-red-400" />
  }
  if (isToolInProgress(state)) {
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-orange)]" />
    )
  }
  if (isToolError(state)) {
    return <XCircle className="h-3.5 w-3.5 text-destructive" />
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
}
