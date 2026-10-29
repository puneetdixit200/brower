import { describe, expect, test } from 'bun:test'
import { resolveHomeSearchUrl } from '@/screens/agent-command/home-search'
import { registerAddressBarSearchListener } from './address-bar-search'

describe('Aster address-bar search listener', () => {
  test('resolves URLs, searches, and unsafe schemes consistently with home', () => {
    expect(resolveHomeSearchUrl('https://example.com/a?b=c')).toBe(
      'https://example.com/a?b=c',
    )
    expect(resolveHomeSearchUrl('aster browser')).toBe(
      'https://www.google.com/search?q=aster%20browser',
    )
    expect(resolveHomeSearchUrl('javascript:alert(1)')).toContain(
      'google.com/search?',
    )
    expect(resolveHomeSearchUrl('file:///etc/passwd')).toContain(
      'google.com/search?',
    )
    expect(resolveHomeSearchUrl('  ')).toBeNull()
  })

  test('opens a URL or search only after explicit Enter', async () => {
    let onEnter:
      | ((
          text: string,
          disposition: 'currentTab' | 'newForegroundTab' | 'newBackgroundTab',
        ) => void)
      | undefined
    const created: { url: string; active: boolean }[] = []
    const updated: { url: string }[] = []
    registerAddressBarSearchListener(
      { onInputEntered: { addListener: (listener) => (onEnter = listener) } },
      {
        create: async (properties) => {
          created.push(properties)
        },
        update: async (properties) => {
          updated.push(properties)
        },
      },
    )

    expect(created).toEqual([])
    onEnter?.('https://example.com/path?q=one', 'newForegroundTab')
    onEnter?.('aster browser', 'newBackgroundTab')
    onEnter?.('example.org', 'currentTab')
    await Promise.resolve()
    expect(created).toEqual([
      { url: 'https://example.com/path?q=one', active: true },
      { url: 'https://www.google.com/search?q=aster%20browser', active: false },
    ])
    expect(updated).toEqual([{ url: 'https://example.org' }])
  })

  test('does nothing for blank input', () => {
    let onEnter:
      | ((
          text: string,
          disposition: 'currentTab' | 'newForegroundTab' | 'newBackgroundTab',
        ) => void)
      | undefined
    const tabs = {
      create: async () => {
        throw new Error('should not create a tab')
      },
      update: async () => {
        throw new Error('should not update a tab')
      },
    }
    registerAddressBarSearchListener(
      { onInputEntered: { addListener: (listener) => (onEnter = listener) } },
      tabs,
    )
    onEnter?.('  ', 'newForegroundTab')
  })
})
