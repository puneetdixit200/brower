import { describe, expect, test } from 'bun:test'
import { navigateSelectedWebTab } from './browser-navigation-actions'

function createApi(tabs: { id?: number; url?: string }[]) {
  const calls: string[] = []
  return {
    calls,
    api: {
      query: async (queryInfo: { currentWindow: true }) => {
        calls.push(`query:${queryInfo.currentWindow}`)
        return tabs
      },
      goBack: async (tabId: number) => {
        calls.push(`back:${tabId}`)
      },
      goForward: async (tabId: number) => {
        calls.push(`forward:${tabId}`)
      },
    },
  }
}

describe('navigateSelectedWebTab', () => {
  test('revalidates the selected current-window web tab before going back', async () => {
    const { api, calls } = createApi([{ id: 17, url: 'https://example.test' }])

    await navigateSelectedWebTab(api, 17, 'back')

    expect(calls).toEqual(['query:true', 'back:17'])
  })

  test('goes forward for the revalidated selected web tab', async () => {
    const { api, calls } = createApi([{ id: 21, url: 'http://example.test' }])

    await navigateSelectedWebTab(api, 21, 'forward')

    expect(calls).toEqual(['query:true', 'forward:21'])
  })

  test.each([
    ['closed tab', []],
    ['tab in another window', [{ id: 18, url: 'https://example.test' }]],
    ['non-web page', [{ id: 17, url: 'chrome://settings' }]],
    ['missing URL', [{ id: 17 }]],
  ])(
    'does not dispatch when the selected tab is unavailable: %s',
    async (_case, tabs) => {
      const { api, calls } = createApi(tabs)

      await expect(navigateSelectedWebTab(api, 17, 'back')).rejects.toThrow()

      expect(calls).toEqual(['query:true'])
    },
  )

  test('does not query or dispatch when there is no selection', async () => {
    const { api, calls } = createApi([{ id: 17, url: 'https://example.test' }])

    await expect(navigateSelectedWebTab(api, null, 'forward')).rejects.toThrow()

    expect(calls).toEqual([])
  })

  test('propagates browser API failures for the existing action error feedback', async () => {
    const api = {
      query: async () => [{ id: 17, url: 'https://example.test' }],
      goBack: async () => {
        throw new Error('navigation failed')
      },
      goForward: async () => {},
    }

    await expect(navigateSelectedWebTab(api, 17, 'back')).rejects.toThrow(
      'navigation failed',
    )
  })
})
