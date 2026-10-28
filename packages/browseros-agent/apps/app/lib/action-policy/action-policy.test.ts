import { describe, expect, it } from 'bun:test'
import {
  ACTION_POLICY_IDS,
  normalizeExpiredActionPolicy,
  parseActionPolicyList,
  parseUpdatedActionPolicy,
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
