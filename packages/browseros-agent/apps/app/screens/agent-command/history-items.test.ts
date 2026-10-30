import { describe, expect, it } from 'bun:test'
import {
  loadRecentHistory,
  RECENT_HISTORY_QUERY_LIMIT,
  selectRecentHistory,
} from './history-items'

describe('selectRecentHistory', () => {
  it('keeps HTTP and HTTPS entries and falls back to the URL for an empty title', () => {
    expect(
      selectRecentHistory([
        { id: 'https', title: 'Secure', url: 'https://example.com' },
        { id: 'http', title: '', url: 'http://example.org/path' },
      ]),
    ).toEqual([
      { id: 'https', title: 'Secure', url: 'https://example.com' },
      {
        id: 'http',
        title: 'http://example.org/path',
        url: 'http://example.org/path',
      },
    ])
  })

  it('rejects internal, file, javascript, and malformed URLs', () => {
    expect(
      selectRecentHistory([
        { id: 'chrome', url: 'chrome://settings' },
        { id: 'file', url: 'file:///tmp/page.html' },
        { id: 'script', url: 'javascript:alert(1)' },
        { id: 'broken', url: 'http://[invalid' },
        { id: 'space', url: 'not a URL' },
      ]),
    ).toEqual([])
  })

  it('filters before applying the eight-entry cap while preserving order', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `internal-${index}`,
        url: 'chrome://history',
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `web-${index}`,
        url: `https://example.com/${index}`,
      })),
    ]

    expect(selectRecentHistory(entries).map(({ id }) => id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `web-${index}`),
    )
  })

  it('finds recent web entries beyond 32 non-web rows without timestamp paging', async () => {
    const entries = [
      ...Array.from({ length: 248 }, (_, index) => ({
        id: `internal-${index}`,
        lastVisitTime: 100,
        url: 'file:///tmp/page.html',
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `web-${index}`,
        lastVisitTime: 100,
        url: `https://example.com/${index}`,
      })),
    ]
    const requests: unknown[] = []

    const rows = await loadRecentHistory(async (query) => {
      requests.push(query)
      return entries
    })

    expect(RECENT_HISTORY_QUERY_LIMIT).toBe(256)
    expect(requests).toEqual([
      { text: '', startTime: 0, maxResults: RECENT_HISTORY_QUERY_LIMIT },
    ])
    expect(rows.map(({ id }) => id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `web-${index}`),
    )
  })
})
