import { describe, expect, test } from 'bun:test'
import { selectRecentlyClosedTabSessionId } from './recently-closed-tab'

describe('selectRecentlyClosedTabSessionId', () => {
  test('selects an eligible tab from the current window', () => {
    expect(
      selectRecentlyClosedTabSessionId(
        [{ tab: { sessionId: 'session-1', windowId: 7 } }],
        7,
      ),
    ).toBe('session-1')
  })

  test('skips a tab from another window', () => {
    expect(
      selectRecentlyClosedTabSessionId(
        [
          { tab: { sessionId: 'other-window', windowId: 8 } },
          { tab: { sessionId: 'current-window', windowId: 7 } },
        ],
        7,
      ),
    ).toBe('current-window')
  })

  test.each([
    ['missing session id', { tab: { windowId: 7 } }],
    [
      'incognito tab',
      { tab: { sessionId: 'private', windowId: 7, incognito: true } },
    ],
    ['window session', { window: { sessionId: 'window-session' } }],
    ['entry without a tab', {}],
  ])('skips %s entries', (_name, entry) => {
    expect(selectRecentlyClosedTabSessionId([entry], 7)).toBeUndefined()
  })

  test('returns undefined for an empty list', () => {
    expect(selectRecentlyClosedTabSessionId([], 7)).toBeUndefined()
  })

  test('requires a known current window id', () => {
    expect(
      selectRecentlyClosedTabSessionId(
        [{ tab: { sessionId: 'unknown-window' } }],
        undefined,
      ),
    ).toBeUndefined()
  })

  test('preserves the most-recent eligible tab ordering', () => {
    expect(
      selectRecentlyClosedTabSessionId(
        [
          { tab: { sessionId: 'newest', windowId: 7 } },
          { tab: { sessionId: 'older', windowId: 7 } },
        ],
        7,
      ),
    ).toBe('newest')
  })
})
