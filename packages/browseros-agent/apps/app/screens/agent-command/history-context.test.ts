import { describe, expect, test } from 'bun:test'
import {
  consumePendingHomeMessage,
  stagePendingHomeMessage,
} from '@/modules/chat/pending-home-message'
import {
  canSearchBrowserHistory,
  withSelectedHistoryContext,
} from './history-context'
import { buildHomeSidepanelHandoff } from './home-sidepanel-handoff'

describe('selected history context', () => {
  test('disables history search in incognito context', () => {
    expect(canSearchBrowserHistory(true)).toBe(false)
    expect(canSearchBrowserHistory(false)).toBe(true)
  })

  test('leaves the message alone when no history was selected', () => {
    expect(withSelectedHistoryContext('Question', [])).toBe('Question')
  })

  test('includes only the selected title, site origin, and visit time', () => {
    const message = withSelectedHistoryContext('Question', [
      {
        id: '1',
        title: 'Aster design notes',
        url: 'https://example.com/project/page?session=secret#private',
        lastVisitTime: Date.UTC(2026, 9, 27),
      },
    ])
    expect(message).toContain('Aster design notes')
    expect(message).toContain('https://example.com')
    expect(message.match(/Aster design notes/g)).toHaveLength(1)
    expect(message.match(/https:\/\/example\.com/g)).toHaveLength(1)
    expect(message).not.toContain('/project/page')
    expect(message).not.toContain('session=secret')
    expect(message).not.toContain('#private')
  })

  test('caps the number of selected history items at three', () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      title: `Entry ${index}`,
      url: `https://example${index}.com/page`,
    }))
    const message = withSelectedHistoryContext('Question', entries)
    expect(message).toContain('Entry 2')
    expect(message).not.toContain('Entry 3')
  })

  test('builds the sidepanel model query from selected history exactly once', () => {
    const message = withSelectedHistoryContext('Question', [
      {
        id: 'selected',
        title: 'Selected research',
        url: 'https://example.com/path?token=secret#fragment',
      },
    ])
    const payload = buildHomeSidepanelHandoff(message, [])

    expect(payload.query).toBe(message)
    expect(payload.query.match(/Selected research/g)).toHaveLength(1)
    expect(payload.query.match(/https:\/\/example\.com/g)).toHaveLength(1)
    expect(payload.query).not.toContain('/path')
    expect(payload.query).not.toContain('token=secret')
    expect(payload.query).not.toContain('#fragment')
    const action = payload.action
    if (action?.type !== 'browseros') {
      throw new Error('Expected a BrowserOS chat action')
    }
    expect(action.message).toBe(payload.query)
  })

  test('keeps selected history in the one-shot request handoff, not its URL', () => {
    const message = withSelectedHistoryContext('Question', [
      {
        id: 'private',
        title: 'Private research tab',
        url: 'https://example.com/research/path?token=secret#section',
      },
    ])
    const handoff = stagePendingHomeMessage({ text: message, attachments: [] })
    const route = new URLSearchParams({ handoff, mode: 'agent' })

    expect(route.toString()).not.toContain('Private research tab')
    expect(route.toString()).not.toContain('example.com')
    expect(route.toString()).not.toContain('token=secret')
    expect(consumePendingHomeMessage(handoff)?.text).toBe(message)
  })

  test('does not forward non-web URL schemes', () => {
    const message = withSelectedHistoryContext('Question', [
      { id: '1', title: 'Private page', url: 'chrome://settings/private' },
    ])

    expect(message).toContain('Site: unknown site')
    expect(message).not.toContain('chrome://settings')
  })
})
