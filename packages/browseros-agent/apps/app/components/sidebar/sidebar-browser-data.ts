export interface SidebarBookmark {
  id: string
  title: string
  url: string
  folderPath?: string
}

export interface SidebarBookmarkNode {
  id: string
  title?: string
  url?: string
  children?: SidebarBookmarkNode[]
}

/**
 * Bookmarks can contain javascript:, data:, or extension URLs. Never route
 * those through a sidebar action without an explicit supported scheme.
 */
export function safeSidebarBookmarkUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !parsed.username && !parsed.password
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

/**
 * Bounded preorder traversal of Chromium's bookmark folder tree. Retains
 * source folder context and deliberately excludes unsupported URI schemes.
 * The bound prevents a huge imported bookmark profile from freezing the rail.
 */
export function flattenSidebarBookmarkTree(
  roots: readonly SidebarBookmarkNode[],
  limit = 500,
): SidebarBookmark[] {
  const maxItems = Math.max(0, Math.min(5000, Math.floor(limit)))
  if (!maxItems) return []
  const result: SidebarBookmark[] = []
  const stack = roots.map((node) => ({ node, folders: [] as string[] })).reverse()
  let visited = 0
  while (stack.length && result.length < maxItems && visited++ < 12000) {
    const entry = stack.pop()
    if (!entry) break
    const { node, folders } = entry
    const url = safeSidebarBookmarkUrl(node.url)
    if (url) {
      result.push({
        id: node.id,
        title: node.title?.trim() || new URL(url).hostname,
        url,
        folderPath: folders.filter(Boolean).join(' / '),
      })
    }
    if (node.children?.length) {
      const path = node.title && node.id !== '0'
        ? [...folders, node.title]
        : folders
      for (let index = node.children.length - 1; index >= 0; index--) {
        stack.push({ node: node.children[index], folders: path })
      }
    }
  }
  return result
}
