import { describe, expect, it, mock } from 'bun:test'
import {
  CurrentWindowTabs,
  type CurrentWindowTabsApi,
  filterCommandPaletteTabs,
} from './command-palette-tabs'

const tabs = [
  { id: 1, title: 'Aster app', url: 'chrome-extension://extension/app.html' },
  { id: 2, title: 'Documentation', url: 'https://docs.example.test/guide' },
  { id: 3, title: 'Example', url: 'https://example.test/' },
  {
    id: 4,
    title: 'Other extension',
    url: 'chrome-extension://other/options.html',
  },
  { title: 'Missing tab id', url: 'https://missing.example.test/' },
]

describe('command palette tab helpers', () => {
  it('filters by title or URL and excludes non-activatable tabs', () => {
    expect(filterCommandPaletteTabs(tabs, 'DOCS').map((tab) => tab.id)).toEqual(
      [2],
    )
    expect(
      filterCommandPaletteTabs(tabs, 'example.test').map((tab) => tab.id),
    ).toEqual([2, 3])
    expect(filterCommandPaletteTabs(tabs, '').map((tab) => tab.id)).toEqual([
      1, 2, 3, 4,
    ])
  })

  it('queries only the current window and activates the selected tab', async () => {
    const query = mock(async (_query: { currentWindow: true }) => tabs)
    const update = mock(
      async (_id: number, _properties: { active: true }) => ({}),
    )
    const api: CurrentWindowTabsApi = { query, update }
    const currentWindowTabs = new CurrentWindowTabs(
      api,
      'chrome-extension://extension/',
    )

    expect((await currentWindowTabs.query())?.map((tab) => tab.id)).toEqual([
      2, 3, 4,
    ])
    expect(query).toHaveBeenCalledWith({ currentWindow: true })
    await currentWindowTabs.activate(3)
    expect(update).toHaveBeenCalledWith(3, { active: true })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('does not activate a tab that moved to another window', async () => {
    const query = mock(async (_query: { currentWindow: true }) =>
      tabs.filter((tab) => tab.id !== 3),
    )
    const update = mock(
      async (_id: number, _properties: { active: true }) => ({}),
    )
    const currentWindowTabs = new CurrentWindowTabs({ query, update })

    await expect(currentWindowTabs.activate(3)).rejects.toThrow(
      'Tab is no longer in the current window',
    )
    expect(query).toHaveBeenCalledWith({ currentWindow: true })
    expect(update).not.toHaveBeenCalled()
  })

  it('discards a query that completes after the palette closes', async () => {
    let resolveQuery!: (value: typeof tabs) => void
    const api: CurrentWindowTabsApi = {
      query: () =>
        new Promise((resolve) => {
          resolveQuery = resolve
        }),
      update: async () => ({}),
    }
    const currentWindowTabs = new CurrentWindowTabs(api)
    const pending = currentWindowTabs.query()
    currentWindowTabs.cancelPendingQuery()
    resolveQuery(tabs)

    expect(await pending).toBeUndefined()
  })

  it('propagates query and activation API errors for visible UI handling', async () => {
    const api: CurrentWindowTabsApi = {
      query: async () => {
        throw new Error('query failed')
      },
      update: async () => ({}),
    }
    const currentWindowTabs = new CurrentWindowTabs(api)

    await expect(currentWindowTabs.query()).rejects.toThrow('query failed')
    const activationApi: CurrentWindowTabsApi = {
      query: async () => [{ id: 2, title: 'Still open' }],
      update: async () => {
        throw new Error('closed tab')
      },
    }
    await expect(
      new CurrentWindowTabs(activationApi).activate(2),
    ).rejects.toThrow('closed tab')
  })
})
