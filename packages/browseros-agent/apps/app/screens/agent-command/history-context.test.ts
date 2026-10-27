import { describe, expect, test } from 'bun:test'
import {
  canSearchBrowserHistory,
  withSelectedHistoryContext,
} from './history-context'

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
})
