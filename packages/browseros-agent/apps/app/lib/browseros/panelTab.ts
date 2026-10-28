/** Native contextual panel URLs carry ownership; tab activation never changes it. */
export function panelTabIdFromUrl(url: string): number | undefined {
  const value = new URL(url).searchParams.get('tabId')
  if (value === null || !/^\d+$/.test(value)) return undefined
  const tabId = Number(value)
  return Number.isSafeInteger(tabId) ? tabId : undefined
}

/** Request-time owner resolution must never infer ownership from activeTab. */
export async function resolvePanelTabId(
  url = location.href,
): Promise<number | undefined> {
  return panelTabIdFromUrl(url)
}

/** Legacy UI state may follow an existing panel without an owner in its URL. */
export async function resolvePanelTabIdForConversation(): Promise<
  number | undefined
> {
  const tabId = panelTabIdFromUrl(location.href)
  if (tabId !== undefined) return tabId
  // Compatibility for conversation restoration in an already-open legacy
  // panel. Request context uses resolvePanelTabId and remains fail-closed.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}
