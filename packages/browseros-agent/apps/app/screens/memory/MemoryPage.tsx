import { type FC, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { useIncognitoWindow } from '@/lib/browseros/use-incognito-window'
import type { ExecutionTaskRecord } from '@/lib/execution-history/types'
import { SiteRecipesPanel } from './SiteRecipesPanel'
import { createTaskMemoryDraft } from './task-memory-draft'

interface MemoryEntry {
  id: string
  content: string
  sourceUrl: string | null
  source: 'user' | 'task'
  sourceId: string | null
  sourceTitle: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
}

interface MemorySettings {
  enabled: boolean
  retentionDays: 30 | 90 | null
  updatedAt: number
}

const request = async <T,>(
  path: string,
  incognito: boolean,
  init?: RequestInit,
): Promise<T> => {
  const baseUrl = await getAgentServerUrl()
  const response = await fetch(`${baseUrl}/memory${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Aster-Incognito': String(incognito),
      ...init?.headers,
    },
  })
  const responseText = await response.text()
  let body: (T & { error?: string }) | null = null
  try {
    body = JSON.parse(responseText) as T & { error?: string }
  } catch {
    body = null
  }
  if (!response.ok)
    throw new Error(body?.error ?? `Request failed: ${response.status}`)
  if (!body) throw new Error('The memory service returned an invalid response')
  return body
}

export const MemoryPage: FC = () => {
  const incognito = useIncognitoWindow()
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [settings, setSettings] = useState<MemorySettings | null>(null)
  const [content, setContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [sourceTitle, setSourceTitle] = useState<string | null>(null)
  const [completedTasks, setCompletedTasks] = useState<ExecutionTaskRecord[]>(
    [],
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const result = await request<{
      memories: MemoryEntry[]
      settings: MemorySettings
    }>('', incognito)
    setMemories(result.memories)
    setSettings(result.settings)
    if (result.settings.enabled) {
      const stored = await chrome.storage.local.get(
        'executionHistoryByConversation',
      )
      const histories = stored.executionHistoryByConversation as
        | Record<string, { tasks?: ExecutionTaskRecord[] }>
        | undefined
      const tasks = Object.values(histories ?? {})
        .flatMap((history) => history.tasks ?? [])
        .filter(
          (task) =>
            task.status === 'completed' && createTaskMemoryDraft(task) !== null,
        )
        .sort((left, right) =>
          (right.completedAt ?? right.startedAt).localeCompare(
            left.completedAt ?? left.startedAt,
          ),
        )
      setCompletedTasks(tasks.slice(0, 20))
    } else {
      setCompletedTasks([])
    }
  }, [incognito])

  useEffect(() => {
    if (incognito) return
    refresh().catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : 'Could not load memory',
      ),
    )
  }, [refresh, incognito])

  const updateSettings = async (next: Partial<MemorySettings>) => {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      const result = await request<{ settings: MemorySettings }>(
        '/settings',
        incognito,
        {
          method: 'PUT',
          body: JSON.stringify({ ...settings, ...next }),
        },
      )
      setSettings(result.settings)
      await refresh()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not update settings',
      )
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await request(editingId ? `/${editingId}` : '', incognito, {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({
          content,
          sourceUrl: sourceUrl.trim() || null,
          ...(!editingId && sourceId ? { sourceId, sourceTitle } : {}),
        }),
      })
      setContent('')
      setSourceUrl('')
      setSourceId(null)
      setSourceTitle(null)
      setEditingId(null)
      await refresh()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save memory',
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (
      !window.confirm(
        'Delete this memory? It will also be removed from search.',
      )
    )
      return
    setBusy(true)
    try {
      await request(`/${id}`, incognito, { method: 'DELETE' })
      await refresh()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not delete memory',
      )
    } finally {
      setBusy(false)
    }
  }

  const find = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await request<{ memories: MemoryEntry[] }>(
        '/search',
        incognito,
        {
          method: 'POST',
          body: JSON.stringify({ query: search }),
        },
      )
      setMemories(result.memories)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not search memory',
      )
    } finally {
      setBusy(false)
    }
  }

  if (incognito) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="font-semibold text-2xl">Aster Memory</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Saved memory is unavailable in incognito mode. Notes are not loaded or
          stored from this window.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="font-semibold text-2xl">Aster Memory</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Add and manage local notes that you want Aster to find again. Notes
          are never saved from chats automatically; completed tasks can become
          editable drafts for your review.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-destructive text-sm"
        >
          {error}
        </p>
      )}

      {settings && (
        <section className="space-y-4 rounded-lg border p-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(event) =>
                void updateSettings({ enabled: event.target.checked })
              }
            />
            <span>
              <strong>Enable memory</strong>
              <span className="mt-1 block text-muted-foreground">
                When enabled, matching saved notes are available in Memory
                search and completed tasks can be drafted into notes. Notes join
                a request only when you select them from the home composer.
              </span>
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Retention for notes</span>
            <select
              className="rounded-md border bg-background px-3 py-2"
              value={settings.retentionDays ?? 'never'}
              disabled={busy}
              onChange={(event) =>
                void updateSettings({
                  retentionDays:
                    event.target.value === 'never'
                      ? null
                      : (Number(event.target.value) as 30 | 90),
                })
              }
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="never">Keep until deleted</option>
            </select>
          </label>
        </section>
      )}

      <SiteRecipesPanel enabled={settings?.enabled ?? false} incognito={incognito} />

      {settings?.enabled && completedTasks.length > 0 && (
        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h2 className="font-medium">Review completed tasks</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Select a task to draft a note on this device. Nothing is saved
              until you review and press Save.
            </p>
          </div>
          <div className="space-y-2">
            {completedTasks.map((task) => {
              const alreadySaved = memories.some(
                (memory) => memory.sourceId === task.id,
              )
              return (
                <article
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{task.promptText}</p>
                    <p className="text-muted-foreground text-xs">
                      Completed{' '}
                      {new Date(
                        task.completedAt ?? task.startedAt,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || alreadySaved}
                    onClick={() => {
                      const draft = createTaskMemoryDraft(task)
                      if (!draft) return
                      setEditingId(null)
                      setContent(draft.content)
                      setSourceUrl('')
                      setSourceId(draft.sourceId)
                      setSourceTitle(draft.sourceTitle)
                    }}
                  >
                    {alreadySaved ? 'Saved' : 'Review draft'}
                  </Button>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">
          {sourceId ? 'Review task memory draft' : 'Add a note'}
        </h2>
        {sourceId && (
          <p className="text-muted-foreground text-sm">
            From task: {sourceTitle}. Edit the draft and save only details you
            want Aster to remember.
          </p>
        )}
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={20_000}
          placeholder="Write a preference, reminder, or project note…"
        />
        <input
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="Source link (optional, HTTP or HTTPS)"
        />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            Avoid passwords, keys, and other secrets.
          </span>
          <div className="flex gap-2">
            {editingId && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingId(null)
                  setContent('')
                  setSourceUrl('')
                  setSourceId(null)
                  setSourceTitle(null)
                }}
              >
                Cancel edit
              </Button>
            )}
            <Button
              disabled={busy || !content.trim()}
              onClick={() => void save()}
            >
              {editingId ? 'Update note' : 'Save note'}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void find()
          }}
        >
          <input
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search saved notes"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !search.trim()}
          >
            Search
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void refresh()}
          >
            All
          </Button>
        </form>
        <div className="space-y-3">
          {memories.map((memory) => (
            <article
              key={memory.id}
              className="space-y-2 rounded-lg border p-4"
            >
              <p className="whitespace-pre-wrap text-sm">{memory.content}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
                <span>
                  {memory.source === 'task' ? (
                    <span>
                      From task: {memory.sourceTitle ?? 'Completed task'}
                      {' · Task ID: '}
                      <code className="break-all">
                        {memory.sourceId ?? 'unknown'}
                      </code>
                    </span>
                  ) : memory.sourceUrl ? (
                    <a
                      className="underline"
                      href={memory.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source link
                    </a>
                  ) : (
                    'Added by you'
                  )}{' '}
                  · Updated {new Date(memory.updatedAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(memory.id)
                    setContent(memory.content)
                    setSourceUrl(memory.sourceUrl ?? '')
                    setSourceId(memory.sourceId)
                    setSourceTitle(memory.sourceTitle)
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(memory.id)}
                >
                  Delete
                </Button>
              </div>
            </article>
          ))}
          {memories.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
              No notes found.
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
