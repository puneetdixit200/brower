import {
  BotIcon,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  ShieldX,
  XCircle,
} from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from '@/components/ai-elements/task'
import { Button } from '@/components/ui/button'
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
  const triggerTitle = `${completedCount}/${tools.length} actions completed`

  const onManualToggle = (newState: boolean) => {
    setHasUserInteracted(true)
    setIsOpen(newState)
  }

  return (
    <Task open={isOpen} onOpenChange={onManualToggle}>
      <TaskTrigger title={triggerTitle} TriggerIcon={BotIcon} />
      <TaskContent>
        {tools.map((tool) => (
          <div key={tool.toolCallId}>
            <TaskItem className="flex items-center gap-2">
              <ToolStatusIcon state={tool.state} />
              <span className="flex-1">{formatToolName(tool.toolName)}</span>
            </TaskItem>
            {tool.state === 'approval-requested' && tool.approval?.id && (
              <div className="mt-2 ml-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="font-medium text-sm">Review this action</p>
                {tool.approval.reason && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    {tool.approval.reason}
                  </p>
                )}
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-xs">
                  {formatApprovalInput(tool.input)}
                </pre>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      onToolApprovalResponse({
                        id: tool.approval?.id ?? tool.toolCallId,
                        approved: true,
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onToolApprovalResponse({
                        id: tool.approval?.id ?? tool.toolCallId,
                        approved: false,
                      })
                    }
                  >
                    Deny
                  </Button>
                </div>
              </div>
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

function formatApprovalInput(input: Record<string, unknown>): string {
  const redact = (value: unknown, key = ''): unknown => {
    if (/(password|secret|token|api.?key|authorization|cookie)/i.test(key)) {
      return '[redacted]'
    }
    if (Array.isArray(value)) return value.map((item) => redact(item))
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          redact(childValue, childKey),
        ]),
      )
    }
    return value
  }
  try {
    return JSON.stringify(redact(input), null, 2)
  } catch {
    return 'Action details are unavailable.'
  }
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
