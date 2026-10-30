import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  type ActionDecision,
  type ActionPolicy,
  type ActionPolicyDraft,
  type ActionPolicyDraftDirtyFields,
  clearActionPolicyDraftDirtyFields,
  confirmsActionPolicyReset,
  createActionPolicyLoadEpoch,
  mergeActionPolicyDrafts,
  normalizeExpiredActionPolicy,
  parseActionPolicyList,
  parseUpdatedActionPolicy,
  readActionPolicyResponse,
  updateActionPolicyDraftDirtyFields,
} from '@/lib/action-policy/action-policy'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

type Draft = ActionPolicyDraft
type RowStatus = 'saved' | 'saving' | 'resetting' | null

const EXPIRY_CHOICES = [
  { value: 'never', label: 'No expiration' },
  { value: '3600000', label: '1 hour' },
  { value: '86400000', label: '1 day' },
  { value: '604800000', label: '7 days' },
  { value: '2592000000', label: '30 days' },
]

function expiryDraft(expiresAt: number | null): string {
  if (expiresAt === null || expiresAt <= Date.now()) return 'never'
  const duration = expiresAt - Date.now()
  const match = EXPIRY_CHOICES.find(
    (choice) =>
      choice.value !== 'never' &&
      Math.abs(Number(choice.value) - duration) <= 60_000,
  )
  return match?.value ?? 'custom'
}

const makeDrafts = (actions: ActionPolicy[]): Record<string, Draft> =>
  Object.fromEntries(
    actions.map((action) => [
      action.id,
      { decision: action.decision, expiry: expiryDraft(action.expiresAt) },
    ]),
  )

export const ActionPolicyPage: FC = () => {
  const [actions, setActions] = useState<ActionPolicy[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const actionsRef = useRef(actions)
  const draftsRef = useRef(drafts)
  const dirtyDraftFieldsRef = useRef<ActionPolicyDraftDirtyFields>({})
  const baselineDraftsRef = useRef<Record<string, Draft>>({})
  const loadEpochRef = useRef(createActionPolicyLoadEpoch())
  const committedSnapshotRef = useRef<{
    epoch: number
    actions: ActionPolicy[]
  }>({ epoch: 0, actions: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rowStatuses, setRowStatuses] = useState<Record<string, RowStatus>>({})
  actionsRef.current = actions
  draftsRef.current = drafts

  const load = useCallback(
    async (quiet = false, forceRefreshId?: string): Promise<boolean> => {
      const requestEpoch = loadEpochRef.current.begin()
      if (!quiet) setLoading(true)
      setError(null)
      try {
        const serverUrl = await getAgentServerUrl()
        const response = await fetch(`${serverUrl}/action-policy`)
        const body = await readActionPolicyResponse(response)
        const rows = parseActionPolicyList(body).map((row) =>
          normalizeExpiredActionPolicy(row),
        )
        const nextBaselineDrafts = makeDrafts(rows)
        const nextDrafts = mergeActionPolicyDrafts(
          rows,
          draftsRef.current,
          dirtyDraftFieldsRef.current,
          expiryDraft,
          forceRefreshId,
        )
        let nextDirtyFields = dirtyDraftFieldsRef.current
        for (const row of rows) {
          nextDirtyFields = updateActionPolicyDraftDirtyFields(
            nextDirtyFields,
            row.id,
            nextDrafts[row.id],
            nextBaselineDrafts[row.id],
          )
        }
        if (forceRefreshId) {
          const remainingDirty = { ...nextDirtyFields }
          delete remainingDirty[forceRefreshId]
          nextDirtyFields = remainingDirty
        }
        return loadEpochRef.current.commit(
          requestEpoch,
          { rows, nextDrafts, nextDirtyFields, nextBaselineDrafts },
          ({ rows, nextDrafts, nextDirtyFields, nextBaselineDrafts }) => {
            actionsRef.current = rows
            draftsRef.current = nextDrafts
            dirtyDraftFieldsRef.current = nextDirtyFields
            baselineDraftsRef.current = nextBaselineDrafts
            committedSnapshotRef.current = {
              epoch: requestEpoch,
              actions: rows,
            }
            setActions(rows)
            setDrafts(nextDrafts)
          },
        )
      } catch (reason) {
        if (!loadEpochRef.current.isCurrent(requestEpoch)) return false
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not load permission rules',
        )
        return false
      } finally {
        if (!quiet && loadEpochRef.current.isCurrent(requestEpoch))
          setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const reconcileExpired = () => {
      const now = Date.now()
      const expired = actions.filter(
        (action) => action.expiresAt !== null && action.expiresAt <= now,
      )
      if (expired.length > 0) {
        loadEpochRef.current.invalidate()
        const normalized = actions.map((action) =>
          normalizeExpiredActionPolicy(action, now),
        )
        const nextBaselineDrafts = makeDrafts(normalized)
        const expiredIds = new Set(expired.map(({ id }) => id))
        const remainingDirty = { ...dirtyDraftFieldsRef.current }
        for (const id of expiredIds) delete remainingDirty[id]
        const nextDrafts = mergeActionPolicyDrafts(
          normalized,
          draftsRef.current,
          remainingDirty,
          expiryDraft,
        )
        let nextDirtyFields = remainingDirty
        for (const row of normalized) {
          nextDirtyFields = updateActionPolicyDraftDirtyFields(
            nextDirtyFields,
            row.id,
            nextDrafts[row.id],
            nextBaselineDrafts[row.id],
          )
        }
        dirtyDraftFieldsRef.current = nextDirtyFields
        actionsRef.current = normalized
        draftsRef.current = nextDrafts
        baselineDraftsRef.current = nextBaselineDrafts
        setActions(normalized)
        setDrafts(nextDrafts)
        setRowStatuses({})
        return true
      }
      return false
    }

    const nextExpiry = actions.reduce<number | null>((earliest, action) => {
      if (action.expiresAt === null || action.expiresAt <= Date.now())
        return earliest
      return earliest === null
        ? action.expiresAt
        : Math.min(earliest, action.expiresAt)
    }, null)
    const timeoutId =
      nextExpiry === null
        ? undefined
        : window.setTimeout(
            () => {
              reconcileExpired()
              void load(true)
            },
            Math.min(nextExpiry - Date.now(), 2_147_000_000),
          )
    const onResume = () => {
      if (document.visibilityState === 'visible') {
        reconcileExpired()
        void load(true)
      }
    }
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [actions, load])

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }))
    draftsRef.current = {
      ...draftsRef.current,
      [id]: { ...draftsRef.current[id], ...patch },
    }
    dirtyDraftFieldsRef.current = updateActionPolicyDraftDirtyFields(
      dirtyDraftFieldsRef.current,
      id,
      draftsRef.current[id],
      baselineDraftsRef.current[id],
    )
    setRowStatuses((current) => ({ ...current, [id]: null }))
  }

  const save = async (action: ActionPolicy) => {
    if (action.expiresAt !== null && action.expiresAt <= Date.now()) {
      loadEpochRef.current.invalidate()
      const normalized = normalizeExpiredActionPolicy(action)
      setActions((current) =>
        current.map((row) => (row.id === action.id ? normalized : row)),
      )
      setDrafts((current) => ({
        ...current,
        [action.id]: { decision: 'ask', expiry: 'never' },
      }))
      delete dirtyDraftFieldsRef.current[action.id]
      actionsRef.current = actionsRef.current.map((row) =>
        row.id === action.id ? normalized : row,
      )
      draftsRef.current = {
        ...draftsRef.current,
        [action.id]: { decision: 'ask', expiry: 'never' },
      }
      baselineDraftsRef.current = {
        ...baselineDraftsRef.current,
        [action.id]: { decision: 'ask', expiry: 'never' },
      }
      setRowStatuses((current) => ({ ...current, [action.id]: null }))
      void load(true)
      return
    }
    const draft = drafts[action.id]
    if (!draft) return
    setRowStatuses((current) => ({ ...current, [action.id]: 'saving' }))
    setError(null)
    try {
      const serverUrl = await getAgentServerUrl()
      const expiresAt =
        draft.expiry === 'never'
          ? null
          : draft.expiry === 'custom'
            ? action.expiresAt
            : Date.now() + Number(draft.expiry)
      const response = await fetch(
        `${serverUrl}/action-policy/${encodeURIComponent(action.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: draft.decision, expiresAt }),
        },
      )
      const body = await readActionPolicyResponse(response)
      const updated = normalizeExpiredActionPolicy(
        parseUpdatedActionPolicy(body, action.id),
      )
      loadEpochRef.current.invalidate()
      const updatedDraft = {
        decision: updated.decision,
        expiry: expiryDraft(updated.expiresAt),
      }
      delete dirtyDraftFieldsRef.current[updated.id]
      baselineDraftsRef.current = {
        ...baselineDraftsRef.current,
        [updated.id]: updatedDraft,
      }
      setActions((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      )
      setDrafts((current) => ({
        ...current,
        [updated.id]: updatedDraft,
      }))
      actionsRef.current = actionsRef.current.map((row) =>
        row.id === updated.id ? updated : row,
      )
      draftsRef.current = {
        ...draftsRef.current,
        [updated.id]: updatedDraft,
      }
      setRowStatuses((current) => ({ ...current, [action.id]: 'saved' }))
    } catch (reason) {
      setRowStatuses((current) => ({ ...current, [action.id]: null }))
      setError(
        reason instanceof Error ? reason.message : 'Could not save this rule',
      )
    }
  }

  const reset = async (action: ActionPolicy) => {
    setRowStatuses((current) => ({ ...current, [action.id]: 'resetting' }))
    setError(null)
    try {
      const serverUrl = await getAgentServerUrl()
      const response = await fetch(
        `${serverUrl}/action-policy/${encodeURIComponent(action.id)}`,
        { method: 'DELETE' },
      )
      const body = await readActionPolicyResponse(response)
      if (
        typeof body !== 'object' ||
        body === null ||
        !('success' in body) ||
        body.success !== true
      )
        throw new Error('The policy service returned an invalid reset response')
      dirtyDraftFieldsRef.current = clearActionPolicyDraftDirtyFields(
        dirtyDraftFieldsRef.current,
        action.id,
      )
      const resetEpoch = loadEpochRef.current.invalidate()
      const refreshed = await load(true, action.id)
      if (
        !refreshed &&
        !confirmsActionPolicyReset(
          committedSnapshotRef.current,
          action.id,
          resetEpoch,
        )
      )
        throw new Error(
          'The rule was reset, but the updated policy could not be confirmed',
        )
      setRowStatuses((current) => ({ ...current, [action.id]: 'saved' }))
    } catch (reason) {
      setRowStatuses((current) => ({ ...current, [action.id]: null }))
      setError(
        reason instanceof Error ? reason.message : 'Could not reset this rule',
      )
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl">Permission rules</h1>
        <p className="text-muted-foreground text-sm">
          Choose how Aster handles supported action categories. Rules are stored
          by the local agent server and apply across its clients.
        </p>
      </header>

      <div
        role="note"
        className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
      >
        These rules can change the decision for listed action categories,
        including Deny. Read-only mode, immutable safety checks, workspace and
        path limits, and credential protection remain in force and cannot be
        changed here.
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-destructive text-sm"
        >
          {error}
        </div>
      )}
      {loading ? (
        <div
          role="status"
          className="py-8 text-center text-muted-foreground text-sm"
        >
          Loading permission rules…
        </div>
      ) : actions.length === 0 ? (
        <div className="rounded-md border p-6 text-muted-foreground text-sm">
          The agent server did not provide any permission rules.
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((action) => {
            const draft = drafts[action.id]
            const status = rowStatuses[action.id]
            const busy = status === 'saving' || status === 'resetting'
            const dirty =
              draft?.decision !== action.decision ||
              draft?.expiry !== expiryDraft(action.expiresAt)
            return (
              <Card key={action.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {action.label}
                      </CardTitle>
                      <CardDescription className="mt-1 font-mono text-xs">
                        {action.id}
                      </CardDescription>
                    </div>
                    {status === 'saved' && (
                      <span
                        role="status"
                        className="text-green-700 text-xs dark:text-green-400"
                      >
                        Saved
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Decision</span>
                    <select
                      className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm"
                      value={draft?.decision ?? action.decision}
                      disabled={busy}
                      onChange={(event) =>
                        updateDraft(action.id, {
                          decision: event.target.value as ActionDecision,
                        })
                      }
                    >
                      <option value="allow">Allow</option>
                      <option value="ask">Ask each time</option>
                      <option value="deny">Deny</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Expires</span>
                    <select
                      className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm"
                      value={draft?.expiry ?? 'never'}
                      disabled={busy}
                      onChange={(event) =>
                        updateDraft(action.id, { expiry: event.target.value })
                      }
                    >
                      {EXPIRY_CHOICES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                      {draft?.expiry === 'custom' && (
                        <option value="custom">
                          Current expiry (
                          {new Date(action.expiresAt ?? 0).toLocaleString()})
                        </option>
                      )}
                    </select>
                  </label>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void reset(action)}
                    >
                      {status === 'resetting'
                        ? 'Resetting…'
                        : 'Reset to default'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !dirty}
                      onClick={() => void save(action)}
                    >
                      {status === 'saving' ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </main>
  )
}
