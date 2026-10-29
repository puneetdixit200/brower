import { describe, expect, it } from 'bun:test'
import { loadRecentHistory, selectRecentHistory } from './history-items'

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

  it('pages past more than 24 non-web entries and preserves newest-first order', async () => {
    const firstPage = Array.from({ length: 32 }, (_, index) => ({
      id: `internal-${index}`,
      lastVisitTime: 500 - index,
      url: 'chrome://history',
    }))
    const secondPage = Array.from({ length: 8 }, (_, index) => ({
      id: `web-${index}`,
      lastVisitTime: 400 - index,
      url: `https://example.com/${index}`,
    }))
    const endTimes: (number | undefined)[] = []

    const rows = await loadRecentHistory(async (endTime) => {
      endTimes.push(endTime)
      return endTime === undefined ? firstPage : secondPage
    })

    expect(endTimes).toEqual([undefined, 469])
    expect(rows.map(({ id }) => id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `web-${index}`),
    )
  })

  it('stops on a repeated boundary and enforces the hard page cap', async () => {
    const repeatedPage = Array.from({ length: 32 }, (_, index) => ({
      id: `internal-${index}`,
      lastVisitTime: 100,
      url: 'chrome://history',
    }))
    let repeatedCalls = 0
    await loadRecentHistory(async () => {
      repeatedCalls += 1
      return repeatedPage
    })
    expect(repeatedCalls).toBe(2)

    let cappedCalls = 0
    await loadRecentHistory(async () => {
      cappedCalls += 1
      return Array.from({ length: 32 }, (_, index) => ({
        id: `page-${cappedCalls}-${index}`,
        lastVisitTime: 1000 - cappedCalls * 32 - index,
        url: 'chrome://history',
      }))
    })
    expect(cappedCalls).toBe(8)
  })
})
