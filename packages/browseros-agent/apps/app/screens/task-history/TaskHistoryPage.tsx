import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Clock3,
  XCircle,
} from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useIncognitoWindow } from '@/lib/browseros/use-incognito-window'
import type {
  ExecutionHistoryByConversation,
  ExecutionStepRecord,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'
import { flattenExecutionHistory, getTaskResult } from './task-history'

function formatDate(value?: string): string {
  if (!value) return 'In progress'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString()
}

function statusTone(status: ExecutionTaskRecord['status']): string {
  if (status === 'completed') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'running') return 'text-primary'
  return 'text-destructive'
}

function StatusIcon({ status }: { status: ExecutionTaskRecord['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="size-4" />
  if (status === 'running') return <CircleDashed className="size-4" />
  if (status === 'stopped') return <Clock3 className="size-4" />
  return <XCircle className="size-4" />
}

function TaskRow({
  task,
  selected,
}: {
  task: ExecutionTaskRecord
  selected: boolean
}) {
  return (
    <Link
      to={`/tasks/${encodeURIComponent(task.id)}`}
      className={`block rounded-lg border p-4 transition-colors hover:bg-muted/50 ${selected ? 'border-primary bg-muted/40' : ''}`}
    >
      <div className="flex items-start gap-3">
        <span className={statusTone(task.status)} aria-hidden="true">
          <StatusIcon status={task.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium text-sm">{task.promptText}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
            <span>{task.status}</span>
            <span>{formatDate(task.completedAt ?? task.startedAt)}</span>
            <span>{task.steps.length} steps</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function StepTimeline({ steps }: { steps: ExecutionStepRecord[] }) {
  const orderedSteps = [...steps].sort(
    (left, right) => left.order - right.order,
  )

  if (orderedSteps.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
        No browser or tool steps were recorded for this task.
      </p>
    )
  }

  return (
    <ol className="space-y-3">
      {orderedSteps.map((step, index) => (
        <li key={step.id} className="relative rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-sm">
                {index + 1}. {step.toolName}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {formatDate(step.startedAt)}
                {step.completedAt
                  ? ` · Finished ${formatDate(step.completedAt)}`
                  : ''}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs">
              {step.state.replaceAll('-', ' ')}
            </span>
          </div>
          <p className="mt-3 text-sm">{step.previewText}</p>
          {step.approval && (
            <p className="mt-2 text-muted-foreground text-xs">
              {step.approval.approved === false
                ? 'Approval denied'
                : step.approval.approved === true
                  ? 'Approved'
                  : 'Approval requested'}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

export const TaskHistoryPage: FC = () => {
  const incognito = useIncognitoWindow()
  const { taskId } = useParams<{ taskId?: string }>()
  const [tasks, setTasks] = useState<ExecutionTaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (incognito) {
      setTasks([])
      setLoading(false)
      return
    }
    try {
      const stored = await chrome.storage.local.get(
        'executionHistoryByConversation',
      )
      const history = stored.executionHistoryByConversation as
        | ExecutionHistoryByConversation
        | undefined
      setTasks(flattenExecutionHistory(history))
      setError(null)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not load task history',
      )
    } finally {
      setLoading(false)
    }
  }, [incognito])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (incognito) return
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.executionHistoryByConversation)
        void refresh()
    }
    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, [incognito, refresh])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === taskId),
    [tasks, taskId],
  )

  if (incognito) {
    return (
      <section className="space-y-2">
        <h1 className="font-semibold text-2xl">Task History</h1>
        <p className="text-muted-foreground text-sm">
          Task history is unavailable in incognito windows.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header>
        <h1 className="font-semibold text-2xl">Task History</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Review saved task outcomes and the browser/tool steps recorded on this
          device.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 p-3 text-destructive text-sm"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading task history…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            {tasks.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
                No saved tasks are available on this device.
              </p>
            ) : (
              tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === taskId}
                />
              ))
            )}
          </div>

          <div className="min-w-0">
            {!taskId ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
                Choose a task to inspect its result and timeline.
              </p>
            ) : !selectedTask ? (
              <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
                <p className="text-muted-foreground text-sm">
                  This task is unavailable. It may have been cleared or filtered
                  because its text resembles a credential.
                </p>
                <Button asChild variant="outline">
                  <Link to="/tasks">
                    <ArrowLeft className="mr-2 size-4" />
                    Back to task history
                  </Link>
                </Button>
              </div>
            ) : (
              <article className="space-y-5 rounded-lg border p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Button asChild variant="ghost" size="sm" className="-ml-2">
                      <Link to="/tasks">
                        <ArrowLeft className="mr-2 size-4" />
                        All tasks
                      </Link>
                    </Button>
                    <h2 className="font-semibold text-lg">
                      {selectedTask.promptText}
                    </h2>
                    <p className="break-all font-mono text-muted-foreground text-xs">
                      Task ID: {selectedTask.id}
                    </p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-sm capitalize ${statusTone(selectedTask.status)}`}
                  >
                    <StatusIcon status={selectedTask.status} />
                    {selectedTask.status}
                  </span>
                </div>

                <dl className="grid gap-3 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground text-xs">Started</dt>
                    <dd>{formatDate(selectedTask.startedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Finished</dt>
                    <dd>{formatDate(selectedTask.completedAt)}</dd>
                  </div>
                  <div>Actions: {selectedTask.actionCount}</div>
                  <div>Approvals: {selectedTask.approvalCount}</div>
                  <div>Denied: {selectedTask.deniedCount}</div>
                  <div>Errors: {selectedTask.errorCount}</div>
                </dl>

                <section className="space-y-2">
                  <h3 className="font-medium">Response preview</h3>
                  <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                    {getTaskResult(selectedTask) ||
                      'No response preview was recorded.'}
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="font-medium">Timeline</h3>
                  <StepTimeline steps={selectedTask.steps} />
                </section>

                <section className="space-y-2">
                  <h3 className="font-medium">Artifacts</h3>
                  <p className="text-muted-foreground text-sm">
                    No downloadable artifacts are attached to this task record.
                  </p>
                </section>
              </article>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
