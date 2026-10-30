import { describe, expect, test } from 'bun:test'
import { captureVisibleTabContext } from './screenshot-context'

const selectedTab = { id: 8, windowId: 3, url: 'https://example.test/page' }

describe('captureVisibleTabContext', () => {
  test('cancel leaves the page image uncaptured', async () => {
    let captured = false
    const result = await captureVisibleTabContext({
      windowId: 3,
      selectedTabId: 8,
      tabs: [selectedTab],
      confirm: () => false,
      activateAndVerify: async () => true,
      verifyActive: async () => true,
      capture: async () => {
        captured = true
        return 'data:image/png;base64,AA=='
      },
    })
    expect(result).toBeNull()
    expect(captured).toBe(false)
  })

  test('surfaces browser permission denial without producing context', async () => {
    await expect(
      captureVisibleTabContext({
        windowId: 3,
        selectedTabId: 8,
        tabs: [selectedTab],
        confirm: () => true,
        activateAndVerify: async () => true,
        verifyActive: async () => true,
        capture: async () => {
          throw new Error('permission denied')
        },
      }),
    ).rejects.toThrow('permission denied')
  })

  test('captures only the selected web tab in the current window', async () => {
    let capturedWindow: number | undefined
    const result = await captureVisibleTabContext({
      windowId: 3,
      selectedTabId: 8,
      tabs: [{ id: 7, windowId: 3, url: 'https://other.test' }, selectedTab],
      confirm: () => true,
      activateAndVerify: async () => true,
      verifyActive: async () => true,
      capture: async (windowId) => {
        capturedWindow = windowId
        return 'data:image/png;base64,AA=='
      },
    })
    expect(result).toBe('data:image/png;base64,AA==')
    expect(capturedWindow).toBe(3)
  })

  test('rejects a selected tab from another window before capture', async () => {
    let captured = false
    await expect(
      captureVisibleTabContext({
        windowId: 3,
        selectedTabId: 8,
        tabs: [{ ...selectedTab, windowId: 4 }],
        confirm: () => true,
        activateAndVerify: async () => true,
        verifyActive: async () => true,
        capture: async () => {
          captured = true
          return 'data:image/png;base64,AA=='
        },
      }),
    ).rejects.toThrow('Selected website not available')
    expect(captured).toBe(false)
  })

  test('verifies activation before capture and aborts if another tab is active', async () => {
    const events: string[] = []
    await expect(
      captureVisibleTabContext({
        windowId: 3,
        selectedTabId: 8,
        tabs: [selectedTab],
        confirm: () => true,
        activateAndVerify: async () => {
          await Promise.resolve()
          events.push('activation-verified-mismatch')
          return false
        },
        verifyActive: async () => true,
        capture: async () => {
          events.push('captured')
          return 'data:image/png;base64,AA=='
        },
      }),
    ).rejects.toThrow('Selected website is no longer available')
    expect(events).toEqual(['activation-verified-mismatch'])
  })

  test('revalidates the selected website after consent before capture', async () => {
    const events: string[] = []
    await expect(
      captureVisibleTabContext({
        windowId: 3,
        selectedTabId: 8,
        tabs: [selectedTab],
        confirm: () => {
          events.push('consented')
          return true
        },
        activateAndVerify: async () => {
          events.push('current-url-no-longer-web')
          return false
        },
        verifyActive: async () => true,
        capture: async () => {
          events.push('captured')
          return 'data:image/png;base64,AA=='
        },
      }),
    ).rejects.toThrow('Selected website is no longer available')
    expect(events).toEqual(['consented', 'current-url-no-longer-web'])
  })

  test('does not capture until activation has completed and been verified', async () => {
    const events: string[] = []
    await captureVisibleTabContext({
      windowId: 3,
      selectedTabId: 8,
      tabs: [selectedTab],
      confirm: () => true,
      activateAndVerify: async (windowId, tabId) => {
        events.push(`activated:${windowId}:${tabId}`)
        return true
      },
      verifyActive: async (windowId, tabId) => {
        events.push(`verified-after-capture:${windowId}:${tabId}`)
        return true
      },
      capture: async (windowId, tabId) => {
        events.push(`captured:${windowId}:${tabId}`)
        return 'data:image/png;base64,AA=='
      },
    })
    expect(events).toEqual([
      'activated:3:8',
      'captured:3:8',
      'verified-after-capture:3:8',
    ])
  })

  test('discards the image when the active tab changes during capture', async () => {
    const events: string[] = []
    await expect(
      captureVisibleTabContext({
        windowId: 3,
        selectedTabId: 8,
        tabs: [selectedTab],
        confirm: () => true,
        activateAndVerify: async () => true,
        capture: async () => {
          events.push('captured')
          return 'data:image/png;base64,private-image'
        },
        verifyActive: async () => {
          events.push('different-tab-active')
          return false
        },
      }),
    ).rejects.toThrow('Selected website changed during screenshot capture')
    expect(events).toEqual(['captured', 'different-tab-active'])
  })
})
