export interface SidebarMovableTab {
  id?: number
  index: number
  pendingUrl?: string
  pinned?: boolean
  url?: string
}

export interface SidebarTabMoveApi {
  queryCurrentWindow(): Promise<readonly SidebarMovableTab[]>
  move(tabId: number, index: number): Promise<unknown>
}

export type SidebarDropPosition = 'before' | 'after'

/** Reorders one live tab relative to another tab in the same pinned group. */
export async function reorderSidebarTab(
  api: SidebarTabMoveApi,
  tabId: number,
  targetTabId: number,
  position: SidebarDropPosition,
  extensionOrigin: string,
): Promise<'moved' | 'noop'> {
  if (
    !Number.isSafeInteger(tabId) ||
    tabId < 0 ||
    !Number.isSafeInteger(targetTabId) ||
    targetTabId < 0
  ) {
    throw new Error('Invalid tab identifier')
  }
  if (tabId === targetTabId) return 'noop'

  // Use fresh browser state at the last possible moment. The rendered list can
  // be stale if either tab was moved, closed, or replaced during a drag.
  const tabs = [...(await api.queryCurrentWindow())].sort(
    (left, right) => left.index - right.index,
  )
  if (
    tabs.some(
      (tab, index) =>
        !Number.isSafeInteger(tab.index) ||
        tab.index !== index ||
        !Number.isSafeInteger(tab.id) ||
        (tab.id ?? -1) < 0,
    )
  ) {
    throw new Error('Invalid current-window tab order')
  }
  let sawUnpinned = false
  for (const tab of tabs) {
    if (tab.pinned === true && sawUnpinned) {
      throw new Error('Invalid current-window pinned order')
    }
    if (tab.pinned !== true) sawUnpinned = true
  }

  const sourceIndex = tabs.findIndex((tab) => tab.id === tabId)
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId)
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new Error('A tab is no longer in this window')
  }
  const source = tabs[sourceIndex]
  const target = tabs[targetIndex]
  if (
    source.url?.startsWith(extensionOrigin) ||
    source.pendingUrl?.startsWith(extensionOrigin) ||
    target.url?.startsWith(extensionOrigin) ||
    target.pendingUrl?.startsWith(extensionOrigin)
  ) {
    throw new Error('Application tabs cannot be reordered')
  }
  const sourcePinned = source.pinned === true
  const targetPinned = target.pinned === true
  if (sourcePinned !== targetPinned) {
    throw new Error('Tabs cannot move across pinned groups')
  }

  const remaining = tabs.filter((tab) => tab.id !== tabId)
  const targetAfterRemoval = remaining.findIndex(
    (tab) => tab.id === targetTabId,
  )
  if (targetAfterRemoval < 0) {
    throw new Error('A tab is no longer in this window')
  }
  const destination = targetAfterRemoval + (position === 'after' ? 1 : 0)
  if (!Number.isSafeInteger(destination) || destination < 0) {
    throw new Error('Invalid tab destination')
  }

  const pinnedCount = tabs.filter((tab) => tab.pinned === true).length
  const minIndex = sourcePinned ? 0 : pinnedCount
  // The destination index is measured in the final tab strip. After removing
  // the source tab, the valid unpinned end position equals `remaining.length`.
  const maxIndex = sourcePinned ? pinnedCount - 1 : remaining.length
  if (destination < minIndex || destination > maxIndex) {
    throw new Error('Invalid tab destination')
  }
  if (destination === sourceIndex) return 'noop'

  await api.move(tabId, destination)
  return 'moved'
}
