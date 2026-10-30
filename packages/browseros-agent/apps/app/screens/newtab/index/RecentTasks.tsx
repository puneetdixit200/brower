import { CheckCircle2, CircleDashed, Clock3, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useIncognitoWindow } from '@/lib/browseros/use-incognito-window'
import {
  browserStartupRecoveryMarkerKey,
  executionRecoveryMarkerKey,
  getExecutionRecoveryMarker,
} from '@/lib/execution-history/recovery'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from '@/lib/execution-history/types'
import { buildRecentTasks } from './recent-tasks'

const HISTORY_KEY = 'executionHistoryByConversation'

function StatusIcon({ status }: { status: ExecutionTaskRecord['status'] }) {
  if (status === 'completed') {
    return (
      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
    )
  }
  if (status === 'running') {
    return <CircleDashed className="size-4 text-primary" />
  }
  if (status === 'stopped' || status === 'interrupted') {
    return <Clock3 className="size-4 text-muted-foreground" />
  }
  return <XCircle className="size-4 text-destructive" />
}

/**
 * Recent actual local task records. Never requests server reconciliation or
 * invents a terminal status: a running task stays running until an existing
 * recovery marker or actual task state says otherwise.
 *
 * This surface is private-by-default until the owning window is confirmed.
 */
export function RecentTasks() {
  const incognito = useIncognitoWindow()
  const [tasks, setTasks] = useState<ExecutionTaskRecord[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    if (incognito) {
      setTasks([])
      setError(false)
      return
    }

    let active = true
    let generation = 0

    const refresh = async () => {
      const current = ++generation
      try {
        const initial = await chrome.storage.local.get(HISTORY_KEY)
        const history = initial[HISTORY_KEY] as
          | ExecutionHistoryByConversation
          | undefined
        if (!history || typeof history !== 'object') {
          if (active && current === generation) {
            setTasks([])
            setError(false)
          }
          return
        }
        const running = Object.values(history).flatMap((record) =>
          (record.tasks ?? []).filter((task) => task.status === 'running'),
        )
        const keys = running.flatMap((task) => [
          executionRecoveryMarkerKey(task.id),
          browserStartupRecoveryMarkerKey(task.id),
        ])
        const storedMarkers = keys.length
          ? await chrome.storage.local.get(keys)
          : {}
        const markers = running.flatMap((task) => {
          const marker = getExecutionRecoveryMarker(
            task.id,
            task.conversationId,
            storedMarkers,
          )
          return marker ? [marker] : []
        })
        const recent = buildRecentTasks(history, markers)
        if (active && current === generation) {
          setTasks(recent)
          setError(false)
        }
      } catch {
        if (active && current === generation) setError(true)
      }
    }

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (
        area === 'local' &&
        Object.keys(changes).some(
          (key) =>
            key === HISTORY_KEY ||
            key.startsWith('executionHistoryRecovery:') ||
            key.startsWith('executionHistoryBrowserStartup:'),
        )
      ) {
        void refresh()
      }
    }

    void refresh()
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      active = false
      generation += 1
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [incognito])

  if (incognito) return null
  if (!error && tasks.length === 0) return null

  return (
    <section className="space-y-3" aria-label="Recent browser tasks">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Recent tasks
        </h2>
        <Link
          to="/tasks"
          className="text-muted-foreground text-xs underline-offset-4 hover:underline"
        >
          All tasks
        </Link>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border p-3 text-muted-foreground text-sm"
        >
          Could not read local tasks. Open Task History to retry.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                to={`/tasks/${encodeURIComponent(task.id)}`}
                className="flex h-full min-h-24 flex-col gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <StatusIcon status={task.status} />
                  <span className="truncate text-muted-foreground text-xs capitalize">
                    {task.status.replaceAll('-', ' ')}
                  </span>
                </div>
                <span className="line-clamp-2 break-words font-medium text-sm">
                  {task.promptText}
                </span>
                <span className="mt-auto text-muted-foreground text-xs">
                  {task.steps.length} recorded steps
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
