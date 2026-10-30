import { describe, expect, it } from 'bun:test'
import { openWebsitePermissions } from './website-permissions'

describe('openWebsitePermissions', () => {
  it('opens Chromium site details for the validated selected tab origin', async () => {
    const calls: unknown[] = []
    const queries: unknown[] = []
    await openWebsitePermissions(
      {
        query: async (queryInfo) => {
          queries.push(queryInfo)
          return [
            { id: 3, url: 'https://other.example.test/page' },
            { id: 17, url: 'https://user:secret@example.test:8443/path?q=1' },
          ] as chrome.tabs.Tab[]
        },
        create: async (properties) => {
          calls.push(properties)
          return {} as chrome.tabs.Tab
        },
      },
      17,
    )

    expect(queries).toEqual([{ currentWindow: true }])
    expect(calls).toEqual([
      {
        url: 'chrome://settings/content/siteDetails?site=https%3A%2F%2Fexample.test%3A8443',
      },
    ])
  })

  it('fails closed for missing, moved, or non-web tabs without opening settings', async () => {
    const create = async () => ({}) as chrome.tabs.Tab
    const tabs = {
      query: async () => [{ id: 17, url: 'chrome://settings' }],
      create,
    }

    await expect(openWebsitePermissions(tabs, null)).rejects.toThrow(
      'Select a website first',
    )
    await expect(openWebsitePermissions(tabs, 18)).rejects.toThrow(
      'Website tab moved or closed',
    )
    await expect(openWebsitePermissions(tabs, 17)).rejects.toThrow(
      'Website permissions are only available for web pages',
    )
  })
  it('propagates tab creation errors to the action handler', async () => {
    const error = new Error('Tab creation rejected')
    await expect(
      openWebsitePermissions(
        {
          query: async () => [{ id: 17, url: 'https://example.test/' }],
          create: async () => {
            throw error
          },
        },
        17,
      ),
    ).rejects.toBe(error)
  })
})
