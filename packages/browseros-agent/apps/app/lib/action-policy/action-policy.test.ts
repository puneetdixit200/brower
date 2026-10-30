import { describe, expect, it } from 'bun:test'
import {
  ACTION_POLICY_IDS,
  type ActionPolicy,
  type ActionPolicyDraft,
  clearActionPolicyDraftDirtyFields,
  confirmsActionPolicyReset,
  createActionPolicyLoadEpoch,
  mergeActionPolicyDrafts,
  normalizeExpiredActionPolicy,
  parseActionPolicyList,
  parseUpdatedActionPolicy,
  updateActionPolicyDraftDirtyFields,
} from './action-policy'

const row = {
  id: 'browser.act.click',
  label: 'Click page element',
  decision: 'ask',
  expiresAt: null,
} as const

const completeCatalog = ACTION_POLICY_IDS.map((id) => ({ ...row, id }))

describe('action policy response validation', () => {
  it('accepts the complete catalog and rejects unknown, duplicate, or omitted IDs', () => {
    expect(parseActionPolicyList({ actions: completeCatalog })).toEqual(
      completeCatalog,
    )
    expect(() =>
      parseActionPolicyList({
        actions: completeCatalog.map((action, index) =>
          index === 0 ? { ...action, id: 'browser.interact' } : action,
        ),
      }),
    ).toThrow(/unknown action ID/)
    expect(() =>
      parseActionPolicyList({ actions: [...completeCatalog, row] }),
    ).toThrow(/duplicate action IDs/)
    expect(() =>
      parseActionPolicyList({ actions: completeCatalog.slice(1) }),
    ).toThrow(/incomplete action catalog/)
  })

  it('rejects malformed decisions and expirations', () => {
    const invalidDecision = completeCatalog.map((action, index) =>
      index === 0 ? { ...action, decision: 'maybe' } : action,
    )
    const invalidExpiration = completeCatalog.map((action, index) =>
      index === 0 ? { ...action, expiresAt: 'tomorrow' } : action,
    )
    expect(() => parseActionPolicyList({ actions: invalidDecision })).toThrow(
      /invalid decision/,
    )
    expect(() => parseActionPolicyList({ actions: invalidExpiration })).toThrow(
      /invalid expiration/,
    )
  })

  it('requires an update response to identify the requested action', () => {
    expect(parseUpdatedActionPolicy({ action: row }, row.id)).toEqual(row)
    expect(() =>
      parseUpdatedActionPolicy(
        { action: { ...row, id: 'browser.act.type' } },
        row.id,
      ),
    ).toThrow(/different action/)
  })

  it('normalizes expired decisions back to Ask with no expiry', () => {
    const expired = { ...row, decision: 'deny' as const, expiresAt: 99 }
    expect(normalizeExpiredActionPolicy(expired, 100)).toEqual({
      ...expired,
      decision: 'ask',
      expiresAt: null,
    })
    expect(
      normalizeExpiredActionPolicy({ ...row, expiresAt: 101 }, 100),
    ).toEqual({
      ...row,
      expiresAt: 101,
    })
  })
})

describe('action policy draft refresh', () => {
  it('preserves dirty choices while refreshing pristine rows from the server', () => {
    const server = [
      {
        ...row,
        id: 'browser.act.click' as ActionPolicy['id'],
        decision: 'allow' as const,
      },
      {
        ...row,
        id: 'browser.act.type' as ActionPolicy['id'],
        decision: 'deny' as const,
      },
    ]
    const drafts: Record<string, ActionPolicyDraft> = {
      'browser.act.click': { decision: 'deny' as const, expiry: 'never' },
      'browser.act.type': { decision: 'ask' as const, expiry: 'never' },
    }
    const dirty = { 'browser.act.click': { decision: true as const } }

    expect(
      mergeActionPolicyDrafts(server, drafts, dirty, () => 'never'),
    ).toEqual({
      'browser.act.click': { decision: 'deny', expiry: 'never' },
      'browser.act.type': { decision: 'deny', expiry: 'never' },
    })
  })

  it('reset refreshes server defaults over an unsaved row draft', () => {
    const server = [{ ...row, decision: 'ask' as const }]
    const drafts = {
      [row.id]: { decision: 'deny' as const, expiry: '604800000' },
    }
    const dirty = {
      [row.id]: { decision: true as const, expiry: true as const },
    }

    expect(
      mergeActionPolicyDrafts(server, drafts, dirty, () => 'never', row.id),
    ).toEqual({ [row.id]: { decision: 'ask', expiry: 'never' } })
  })

  it('reclassifies a pristine expiration after time changes without treating it as dirty', () => {
    const server = [{ ...row, expiresAt: 3_600_000 }]
    let classification = '3600000'
    const classify = () => classification
    const first = mergeActionPolicyDrafts(server, {}, {}, classify)
    classification = 'custom'

    expect(mergeActionPolicyDrafts(server, first, {}, classify)).toEqual({
      [row.id]: { decision: 'ask', expiry: 'custom' },
    })
  })

  it('clears a dirty field when the user reverts it to the loaded server baseline', () => {
    const baseline = { decision: 'ask' as const, expiry: 'never' }
    const edited = { decision: 'deny' as const, expiry: 'never' }
    const dirty = updateActionPolicyDraftDirtyFields(
      {},
      row.id,
      edited,
      baseline,
    )

    expect(dirty).toEqual({ [row.id]: { decision: true } })
    expect(
      updateActionPolicyDraftDirtyFields(dirty, row.id, baseline, baseline),
    ).toEqual({})
  })

  it('does not keep a dirty value when a refresh now matches it', () => {
    const server = [{ ...row, decision: 'deny' as const }]
    const draft = { decision: 'deny' as const, expiry: 'never' }
    const dirty = { [row.id]: { decision: true as const } }
    const merged = mergeActionPolicyDrafts(
      server,
      { [row.id]: draft },
      dirty,
      () => 'never',
    )

    expect(merged[row.id]).toEqual(draft)
    expect(
      updateActionPolicyDraftDirtyFields(dirty, row.id, merged[row.id], draft),
    ).toEqual({})
  })
})

describe('action policy load ordering', () => {
  it('does not commit a refresh that resolves after a save invalidates it', async () => {
    const epoch = createActionPolicyLoadEpoch()
    const request = epoch.begin()
    let resolveRefresh!: (value: string) => void
    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    }).then((value) =>
      epoch.commit(request, value, (result) => {
        state = result
      }),
    )
    let state = 'server-before-save'

    epoch.invalidate()
    state = 'saved-policy'
    resolveRefresh('stale-server-response')

    expect(await refresh).toBe(false)
    expect(state).toBe('saved-policy')
  })

  it('keeps a superseding quiet refresh from restoring a reset row draft', () => {
    const epoch = createActionPolicyLoadEpoch()
    const staleQuietRequest = epoch.begin()
    const dirty = { [row.id]: { decision: true as const } }
    const drafts: Record<string, ActionPolicyDraft> = {
      [row.id]: { decision: 'deny' as const, expiry: 'never' },
    }
    const clearedDirty = clearActionPolicyDraftDirtyFields(dirty, row.id)
    epoch.invalidate()
    const resetRequest = epoch.begin()
    const quietRefreshRequest = epoch.begin()
    const resetRows: ActionPolicy[] = [{ ...row, decision: 'ask' as const }]
    let visibleDrafts: Record<string, ActionPolicyDraft> = drafts
    const refreshed = mergeActionPolicyDrafts(
      resetRows,
      drafts,
      clearedDirty,
      () => 'never',
    )

    expect(
      epoch.commit(quietRefreshRequest, refreshed, (value) => {
        visibleDrafts = value
      }),
    ).toBe(true)
    expect(
      epoch.commit(resetRequest, drafts, (value) => {
        visibleDrafts = value
      }),
    ).toBe(false)
    expect(
      epoch.commit(staleQuietRequest, drafts, (value) => {
        visibleDrafts = value
      }),
    ).toBe(false)
    expect(visibleDrafts[row.id]).toEqual({ decision: 'ask', expiry: 'never' })
  })

  it('accepts a newer quiet snapshot confirming that reset removed the override', () => {
    expect(
      confirmsActionPolicyReset({ epoch: 12, actions: [] }, row.id, 10),
    ).toBe(true)
    expect(
      confirmsActionPolicyReset(
        { epoch: 12, actions: [{ ...row, decision: 'ask' as const }] },
        row.id,
        10,
      ),
    ).toBe(true)
    expect(
      confirmsActionPolicyReset({ epoch: 9, actions: [] }, row.id, 10),
    ).toBe(false)
    expect(
      confirmsActionPolicyReset(
        { epoch: 12, actions: [{ ...row, decision: 'deny' as const }] },
        row.id,
        10,
      ),
    ).toBe(false)
  })
})
