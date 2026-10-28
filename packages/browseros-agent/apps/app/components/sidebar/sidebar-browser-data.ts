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

export type SidebarBookmarkEntry =
  | { kind: 'folder'; id: string; title: string }
  | { kind: 'bookmark'; bookmark: SidebarBookmark }

export function isSidebarSearchActive(query: string): boolean {
  return query.trim().length > 0
}

/** Keep rendering and empty-state decisions tied to the same visible rows. */
export function visibleSidebarBookmarkEntries(
  query: string,
  searchResults: readonly SidebarBookmark[],
  folderEntries: readonly SidebarBookmarkEntry[],
): SidebarBookmarkEntry[] {
  return isSidebarSearchActive(query)
    ? searchResults.map((bookmark) => ({ kind: 'bookmark', bookmark }))
    : [...folderEntries]
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
      !parsed.username &&
      !parsed.password
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
        ? [
            {
              id: node.id,
              title: node.title?.trim() || new URL(url).hostname,
              url,
            },
          ]
        : []
    })
    .slice(0, Math.max(0, limit))
}

export interface SidebarTab {
  id?: number
  title?: string
  url?: string
  active?: boolean
  pinned?: boolean
}

export function visibleSidebarTabs(
  tabs: readonly SidebarTab[],
  extensionOrigin: string,
  limit = 50,
): (SidebarTab & { id: number })[] {
  return tabs
    .filter(
      (tab): tab is SidebarTab & { id: number } =>
        Number.isSafeInteger(tab.id) && (tab.id ?? -1) >= 0,
    )
    .filter((tab) => !tab.url?.startsWith(extensionOrigin))
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
  const stack = roots
    .map((node) => ({ node, folders: [] as string[] }))
    .reverse()
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
      const path =
        node.title && node.id !== '0' ? [...folders, node.title] : folders
      for (let index = node.children.length - 1; index >= 0; index--) {
        stack.push({ node: node.children[index], folders: path })
      }
    }
  }
  return result
}

/**
 * Return only the immediate children of a bookmark folder. Folder navigation
 * uses Chromium IDs rather than titles so duplicate folder names remain
 * distinct. The walk is bounded because imported profiles can be very large.
 */
export function sidebarBookmarkEntriesAtPath(
  roots: readonly SidebarBookmarkNode[],
  folderIds: readonly string[] = [],
  limit = 500,
): SidebarBookmarkEntry[] {
  const maxItems = Math.max(0, Math.min(5000, Math.floor(limit)))
  if (!maxItems) return []

  let children = roots.flatMap((root) =>
    root.id === '0' && root.children ? root.children : [root],
  )
  let visited = children.length
  for (const id of folderIds) {
    if (visited > 12000) return []
    const folder = children.find((node) => node.id === id)
    // Reject stale paths rather than accidentally showing another folder.
    if (!folder?.children) return []
    children = folder.children
    visited += children.length
  }
  const entries: SidebarBookmarkEntry[] = []
  for (const node of children) {
    if (entries.length >= maxItems) break
    if (node.children) {
      entries.push({
        kind: 'folder',
        id: node.id,
        title: node.title?.trim() || 'Untitled folder',
      })
      continue
    }
    const url = safeSidebarBookmarkUrl(node.url)
    if (!url) continue
    entries.push({
      kind: 'bookmark',
      bookmark: {
        id: node.id,
        title: node.title?.trim() || new URL(url).hostname,
        url,
      },
    })
  }
  return entries
}
