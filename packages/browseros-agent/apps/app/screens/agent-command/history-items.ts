export type RecentHistoryEntry = {
  id?: string
  lastVisitTime?: number
  title?: string
  url?: string
}

export type RecentHistoryRow = {
  id: string
  title: string
  url: string
}

export type RecentHistoryQuery = {
  text: string
  startTime: number
  maxResults: number
}

const MAX_RECENT_HISTORY = 8
export const RECENT_HISTORY_QUERY_LIMIT = 256

export function selectRecentHistory(
  items: RecentHistoryEntry[],
): RecentHistoryRow[] {
  const rows: RecentHistoryRow[] = []

  for (const item of items) {
    if (!item.id || !item.url) continue

    try {
      const url = new URL(item.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    } catch {
      continue
    }

    rows.push({ id: item.id, title: item.title || item.url, url: item.url })
    if (rows.length === MAX_RECENT_HISTORY) break
  }

  return rows
}

/**
 * Use one bounded query so Chromium timestamp ties cannot strand results
 * between endTime-based pages. The caller requests at most 256 rows.
 */
export async function loadRecentHistory(
  search: (query: RecentHistoryQuery) => Promise<RecentHistoryEntry[]>,
): Promise<RecentHistoryRow[]> {
  return selectRecentHistory(
    await search({
      text: '',
      startTime: 0,
      maxResults: RECENT_HISTORY_QUERY_LIMIT,
    }),
  )
}
