import { describe, expect, it } from 'bun:test'
import {
  recentSidebarBookmarks,
  safeSidebarBookmarkUrl,
  visibleSidebarTabs,
} from './sidebar-browser-data'

describe('sidebar browser data boundaries', () => {
  it('accepts web bookmarks but rejects javascript, data, file and extension URLs', () => {
    expect(safeSidebarBookmarkUrl('https://example.org/a')).toBe('https://example.org/a')
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'chrome-extension://abc/index.html',
      'not a URL',
    ]) {
      expect(safeSidebarBookmarkUrl(value)).toBeNull()
    }
  })

  it('uses real bookmark metadata, not placeholders, and caps results', () => {
    expect(recentSidebarBookmarks([
      { id: '1', title: 'Example', url: 'https://example.org' },
      { id: '2', title: 'Attack', url: 'javascript:alert(1)' },
      { id: '3', title: '', url: 'http://example.net/page' },
    ])).toEqual([
      { id: '1', title: 'Example', url: 'https://example.org/' },
      { id: '3', title: 'example.net', url: 'http://example.net/page' },
    ])
    expect(recentSidebarBookmarks([{ id: '1', url: 'https://example.org' }], 0)).toEqual([])
  })

  it('excludes Aster application tabs and invalid tab identifiers', () => {
    expect(visibleSidebarTabs([
      { id: 1, title: 'Aster', url: 'chrome-extension://aster/app.html' },
      { id: 3, title: 'Docs', url: 'https://example.org', active: true },
      { id: undefined, title: 'Bad', url: 'https://example.net' },
      { id: -1, title: 'Bad', url: 'https://example.net' },
    ], 'chrome-extension://aster/')).toEqual([
      { id: 3, title: 'Docs', url: 'https://example.org', active: true },
    ])
  })
})
