import { describe, expect, it } from 'bun:test'
import {
  flattenSidebarBookmarkTree,
  isSidebarSearchActive,
  recentSidebarBookmarks,
  safeSidebarBookmarkUrl,
  sidebarBookmarkEntriesAtPath,
  visibleSidebarBookmarkEntries,
  visibleSidebarTabs,
} from './sidebar-browser-data'

describe('sidebar browser data boundaries', () => {
  it('accepts web bookmarks but rejects javascript, data, file and extension URLs', () => {
    expect(safeSidebarBookmarkUrl('https://example.org/a')).toBe(
      'https://example.org/a',
    )
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
    expect(
      recentSidebarBookmarks([
        { id: '1', title: 'Example', url: 'https://example.org' },
        { id: '2', title: 'Attack', url: 'javascript:alert(1)' },
        { id: '3', title: '', url: 'http://example.net/page' },
      ]),
    ).toEqual([
      { id: '1', title: 'Example', url: 'https://example.org/' },
      { id: '3', title: 'example.net', url: 'http://example.net/page' },
    ])
    expect(
      recentSidebarBookmarks([{ id: '1', url: 'https://example.org' }], 0),
    ).toEqual([])
  })

  it('preserves folder paths and bounds bookmark tree traversal', () => {
    const tree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: 'Bookmarks bar',
            children: [
              {
                id: '2',
                title: 'Docs',
                children: [
                  { id: '3', title: 'API', url: 'https://example.org/docs' },
                  { id: '4', title: 'Unsafe', url: 'javascript:alert(1)' },
                ],
              },
            ],
          },
        ],
      },
    ]
    expect(flattenSidebarBookmarkTree(tree)).toEqual([
      {
        id: '3',
        title: 'API',
        url: 'https://example.org/docs',
        folderPath: 'Bookmarks bar / Docs',
      },
    ])
    expect(flattenSidebarBookmarkTree(tree, 0)).toEqual([])
  })

  it('lists bookmark folders and opens only the selected nested folder', () => {
    const tree = [
      {
        id: '0',
        children: [
          {
            id: 'bar',
            title: 'Bookmarks bar',
            children: [
              {
                id: 'docs',
                title: 'Docs',
                children: [
                  { id: 'api', title: 'API', url: 'https://example.org/api' },
                  { id: 'unsafe', title: 'Unsafe', url: 'javascript:alert(1)' },
                ],
              },
              { id: 'home', title: 'Home', url: 'https://example.net' },
            ],
          },
        ],
      },
    ]

    expect(sidebarBookmarkEntriesAtPath(tree)).toEqual([
      { kind: 'folder', id: 'bar', title: 'Bookmarks bar' },
    ])
    expect(sidebarBookmarkEntriesAtPath(tree, ['bar'])).toEqual([
      { kind: 'folder', id: 'docs', title: 'Docs' },
      {
        kind: 'bookmark',
        bookmark: {
          id: 'home',
          title: 'Home',
          url: 'https://example.net/',
        },
      },
    ])
    expect(sidebarBookmarkEntriesAtPath(tree, ['bar', 'docs'])).toEqual([
      {
        kind: 'bookmark',
        bookmark: {
          id: 'api',
          title: 'API',
          url: 'https://example.org/api',
        },
      },
    ])
    expect(sidebarBookmarkEntriesAtPath(tree, ['docs'])).toEqual([])
  })

  it('uses folder rows for the bookmark empty-state decision', () => {
    const folderRows = [{ kind: 'folder' as const, id: 'docs', title: 'Docs' }]

    expect(isSidebarSearchActive('   ')).toBe(false)
    expect(isSidebarSearchActive(' api ')).toBe(true)
    expect(visibleSidebarBookmarkEntries('   ', [], folderRows)).toEqual(
      folderRows,
    )
    expect(visibleSidebarBookmarkEntries('', [], folderRows)).toEqual(
      folderRows,
    )
    expect(visibleSidebarBookmarkEntries('api', [], folderRows)).toEqual([])
    expect(
      visibleSidebarBookmarkEntries(
        ' api ',
        [{ id: 'api', title: 'API', url: 'https://example.org/api' }],
        folderRows,
      ),
    ).toEqual([
      {
        kind: 'bookmark',
        bookmark: {
          id: 'api',
          title: 'API',
          url: 'https://example.org/api',
        },
      },
    ])
  })

  it('excludes Aster application tabs and invalid tab identifiers', () => {
    expect(
      visibleSidebarTabs(
        [
          { id: 1, title: 'Aster', url: 'chrome-extension://aster/app.html' },
          { id: 3, title: 'Docs', url: 'https://example.org', active: true },
          { id: undefined, title: 'Bad', url: 'https://example.net' },
          { id: -1, title: 'Bad', url: 'https://example.net' },
        ],
        'chrome-extension://aster/',
      ),
    ).toEqual([
      { id: 3, title: 'Docs', url: 'https://example.org', active: true },
    ])
  })
})
