export interface SidebarBookmark {
  id: string
  title: string
  url: string
}

export interface SidebarBookmarkNode {
  id: string
  title?: string
  url?: string
}

/**
 * Bookmarks can contain javascript:, data:, or extension URLs. Never route
 * those through a sidebar action without an explicit supported scheme.
 */
export function safeSidebarBookmarkUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : null
  } catch {
    return null
  }
}

export function recentSidebarBookmarks(
  nodes: readonly SidebarBookmarkNode[],
  limit = 20,
): SidebarBookmark[] {
  return nodes
    .flatMap((node) => {
      const url = safeSidebarBookmarkUrl(node.url)
      return url
        ? [{
            id: node.id,
            title: node.title?.trim() || new URL(url).hostname,
            url,
          }]
        : []
    })
    .slice(0, Math.max(0, limit))
}

export interface SidebarTab {
  id?: number
  title?: string
  url?: string
  active?: boolean
}

export function visibleSidebarTabs(
  tabs: readonly SidebarTab[],
  extensionOrigin: string,
  limit = 50,
): (SidebarTab & { id: number })[] {
  return tabs
    .filter((tab): tab is SidebarTab & { id: number } =>
      Number.isSafeInteger(tab.id) && (tab.id ?? -1) >= 0,
    )
    .filter(
      (tab) => !tab.url?.startsWith(extensionOrigin),
    )
    .slice(0, Math.max(0, limit))
}
