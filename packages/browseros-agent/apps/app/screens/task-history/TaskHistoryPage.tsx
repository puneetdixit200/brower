import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Download,
  XCircle,
} from 'lucide-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { useIncognitoWindow } from '@/lib/browseros/use-incognito-window'
import {
  applyExecutionRecoveryMarkers,
  executionRecoveryMarkerKey,
  isExecutionRecoveryMarker,
  reconcileInterruptedExecutionTasks,
} from '@/lib/execution-history/recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionStepRecord,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'
import { resolveAgentServerUrl } from '@/modules/browseros/agent-server-url.helpers'
import {
  downloadTaskReport,
  saveTaskReportToChosenDirectory,
} from './export-task-report'
import {
  flattenExecutionHistory,
  getTaskTranscriptResponse,
} from './task-history'

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
          {step.approval?.reason && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              {step.approval.reason}
            </p>
          )}
          {step.errorText && (
            <p className="mt-2 whitespace-pre-wrap break-words text-destructive text-sm">
              {step.errorText}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

async function persistMissingRunMarkers(
  history: ExecutionHistoryByConversation,
): Promise<void> {
  const runningTasks = Object.values(history).flatMap((item) =>
    item.tasks.filter((task) => task.status === 'running'),
  )
  if (runningTasks.length === 0) return

  const serverUrl = await resolveAgentServerUrl()
  const candidates = await reconcileInterruptedExecutionTasks(history, {
    serverUrl,
  })
  if (candidates.length === 0) return

  const latest = await chrome.storage.local.get(
    'executionHistoryByConversation',
  )
  const latestHistory = latest.executionHistoryByConversation as
    | ExecutionHistoryByConversation
    | undefined
  const stillRunning = new Set(
    Object.values(latestHistory ?? {}).flatMap((conversation) =>
      conversation.tasks
        .filter((task) => task.status === 'running')
        .map((task) => `${conversation.conversationId}:${task.id}`),
    ),
  )
  const eligibleMarkers = candidates.filter((marker) =>
    stillRunning.has(`${marker.conversationId}:${marker.taskId}`),
  )
  const keys = eligibleMarkers.map((marker) =>
    executionRecoveryMarkerKey(marker.taskId),
  )
  if (keys.length === 0) return

  const existing = await chrome.storage.local.get(keys)
  const newMarkerEntries = Object.fromEntries(
    eligibleMarkers.flatMap((marker) => {
      const key = executionRecoveryMarkerKey(marker.taskId)
      const existingMarker = existing[key]
      return isExecutionRecoveryMarker(existingMarker) &&
        existingMarker.taskId === marker.taskId &&
        existingMarker.conversationId === marker.conversationId
        ? []
        : [[key, marker]]
    }),
  )
  if (Object.keys(newMarkerEntries).length > 0) {
    await chrome.storage.local.set(newMarkerEntries)
  }
}

async function loadExecutionHistoryTasks(): Promise<ExecutionTaskRecord[]> {
  const initial = await chrome.storage.local.get(
    'executionHistoryByConversation',
  )
  const history = initial.executionHistoryByConversation as
    | ExecutionHistoryByConversation
    | undefined
  if (history) {
    try {
      await persistMissingRunMarkers(history)
    } catch {
      // A server startup or URL failure does not prove a task stopped.
    }
  }

  const latest = await chrome.storage.local.get(
    'executionHistoryByConversation',
  )
  const visibleHistory =
    (latest.executionHistoryByConversation as
      | ExecutionHistoryByConversation
      | undefined) ?? {}
  const runningTasks = Object.values(visibleHistory).flatMap((item) =>
    item.tasks.filter((task) => task.status === 'running'),
  )
  const markerKeys = runningTasks.map((task) =>
    executionRecoveryMarkerKey(task.id),
  )
  const markerValues = markerKeys.length
    ? await chrome.storage.local.get(markerKeys)
    : {}
  const markers = runningTasks.flatMap((task) => {
    const marker = markerValues[executionRecoveryMarkerKey(task.id)]
    return isExecutionRecoveryMarker(marker) &&
      marker.taskId === task.id &&
      marker.conversationId === task.conversationId
      ? [marker]
      : []
  })
  return flattenExecutionHistory(
    applyExecutionRecoveryMarkers(visibleHistory, markers),
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
      setTasks(await loadExecutionHistoryTasks())
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

                <section className="space-y-3">
                  <div>
                    <h3 className="font-medium">Run transcript</h3>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Locally saved prompt, tool-step summaries, and final
                      response. Raw tool inputs and outputs are not stored in
                      task history.
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="mb-2 font-medium text-xs">You</p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {selectedTask.promptText}
                    </p>
                  </div>
                  <h4 className="font-medium text-sm">Tool timeline</h4>
                  <StepTimeline steps={selectedTask.steps} />
                  <div className="rounded-md border p-3">
                    <p className="mb-2 font-medium text-xs">Assistant</p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {getTaskTranscriptResponse(selectedTask) ||
                        'No response was recorded.'}
                    </p>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="font-medium">Artifacts</h3>
                  <p className="text-muted-foreground text-sm">
                    No downloadable artifact descriptors were recorded for this
                    run. Task history does not turn arbitrary tool text or paths
                    into file links.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="font-medium">Local report</h3>
                  <p className="text-muted-foreground text-sm">
                    Download this task’s saved summary and visible timeline as
                    Markdown. Raw tool inputs and outputs are omitted, and
                    records matching known credential patterns are excluded.
                    This is not a full agent workspace artifact archive.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      try {
                        downloadTaskReport(selectedTask)
                        setError(null)
                      } catch {
                        setError('This task could not be exported safely.')
                      }
                    }}
                  >
                    <Download className="mr-2 size-4" />
                    Download Markdown report
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void saveTaskReportToChosenDirectory(selectedTask)
                        .then(() => setError(null))
                        .catch(() =>
                          setError(
                            'Could not save to the chosen folder. No arbitrary path access was granted.',
                          ),
                        )
                    }}
                  >
                    Save into chosen folder
                  </Button>
                </section>
              </article>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
