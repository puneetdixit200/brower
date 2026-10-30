export type ScreenshotContextTab = {
  id?: number
  windowId?: number
  url?: string
}

/** Capture only an explicitly selected HTTP(S) tab, and only after consent. */
export async function captureVisibleTabContext(input: {
  windowId: number | undefined
  selectedTabId: number | null
  tabs: ScreenshotContextTab[]
  confirm: () => boolean
  activateAndVerify: (windowId: number, tabId: number) => Promise<boolean>
  capture: (windowId: number, tabId: number) => Promise<string>
  verifyActive: (windowId: number, tabId: number) => Promise<boolean>
}): Promise<string | null> {
  if (input.windowId === undefined || input.selectedTabId === null) {
    throw new Error('Select a website before capturing')
  }
  const selected = input.tabs.find(
    (tab) =>
      tab.id === input.selectedTabId &&
      tab.windowId === input.windowId &&
      (tab.url?.startsWith('https://') || tab.url?.startsWith('http://')),
  )
  if (!selected || selected.id === undefined) {
    throw new Error('Selected website not available')
  }
  if (!input.confirm()) return null
  const isActive = await input.activateAndVerify(input.windowId, selected.id)
  if (!isActive) throw new Error('Selected website is no longer available')
  const image = await input.capture(input.windowId, selected.id)
  const isStillActive = await input.verifyActive(input.windowId, selected.id)
  if (!isStillActive) {
    throw new Error('Selected website changed during screenshot capture')
  }
  return image
}
