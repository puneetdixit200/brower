import { describe, expect, it } from 'bun:test'
import {
  reorderSidebarTab,
  type SidebarMovableTab,
} from './sidebar-tab-reorder'

const extensionOrigin = 'chrome-extension://aster/'

function fixture(tabs: SidebarMovableTab[]) {
  const calls: [number, number][] = []
  let current = tabs
  const api = {
    queryCurrentWindow: async () => current,
    move: async (tabId: number, index: number) => {
      calls.push([tabId, index])
    },
  }
  return {
    api,
    calls,
    setTabs: (next: SidebarMovableTab[]) => {
      current = next
    },
  }
}

describe('sidebar tab reorder', () => {
  it('moves before and after using the fresh tab order', async () => {
    const before = fixture([
      { id: 1, index: 0 },
      { id: 2, index: 1 },
      { id: 3, index: 2 },
      { id: 4, index: 3 },
    ])
    expect(
      await reorderSidebarTab(before.api, 1, 3, 'before', extensionOrigin),
    ).toBe('moved')
    expect(before.calls).toEqual([[1, 1]])

    const after = fixture([
      { id: 1, index: 0 },
      { id: 2, index: 1 },
      { id: 3, index: 2 },
      { id: 4, index: 3 },
    ])
    expect(
      await reorderSidebarTab(after.api, 4, 2, 'after', extensionOrigin),
    ).toBe('moved')
    expect(after.calls).toEqual([[4, 2]])

    const afterLast = fixture([
      { id: 1, index: 0 },
      { id: 2, index: 1 },
      { id: 3, index: 2 },
    ])
    expect(
      await reorderSidebarTab(afterLast.api, 1, 3, 'after', extensionOrigin),
    ).toBe('moved')
    expect(afterLast.calls).toEqual([[1, 2]])
  })

  it('returns no-op for the same tab or an already-adjacent position', async () => {
    const same = fixture([{ id: 1, index: 0 }])
    expect(
      await reorderSidebarTab(same.api, 1, 1, 'before', extensionOrigin),
    ).toBe('noop')
    expect(same.calls).toEqual([])

    const adjacent = fixture([
      { id: 1, index: 0 },
      { id: 2, index: 1 },
      { id: 3, index: 2 },
    ])
    expect(
      await reorderSidebarTab(adjacent.api, 1, 2, 'before', extensionOrigin),
    ).toBe('noop')
    expect(adjacent.calls).toEqual([])
  })

  it('rejects stale, extension-owned, cross-pinned, and invalid-index tabs', async () => {
    const stale = fixture([
      { id: 1, index: 0 },
      { id: 3, index: 1 },
    ])
    await expect(
      reorderSidebarTab(stale.api, 1, 2, 'before', extensionOrigin),
    ).rejects.toThrow('no longer in this window')

    const extensionTab = fixture([
      {
        id: 1,
        index: 0,
        url: 'about:blank',
        pendingUrl: `${extensionOrigin}index.html`,
      },
      { id: 2, index: 1, url: 'https://example.org' },
    ])
    await expect(
      reorderSidebarTab(extensionTab.api, 1, 2, 'before', extensionOrigin),
    ).rejects.toThrow('Application tabs')

    const pinned = fixture([
      { id: 1, index: 0, pinned: true },
      { id: 2, index: 1, pinned: false },
    ])
    await expect(
      reorderSidebarTab(pinned.api, 1, 2, 'after', extensionOrigin),
    ).rejects.toThrow('pinned groups')

    const invalidIndex = fixture([
      { id: 1, index: 0 },
      { id: 2, index: 2 },
    ])
    await expect(
      reorderSidebarTab(invalidIndex.api, 1, 2, 'before', extensionOrigin),
    ).rejects.toThrow('Invalid current-window tab order')
  })

  it('propagates browser API move failures', async () => {
    const failure = new Error('move denied')
    const current = fixture([
      { id: 1, index: 0 },
      { id: 2, index: 1 },
    ])
    current.api.move = async () => {
      throw failure
    }
    await expect(
      reorderSidebarTab(current.api, 2, 1, 'before', extensionOrigin),
    ).rejects.toBe(failure)
  })
})
