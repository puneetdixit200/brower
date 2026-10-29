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

const MAX_RECENT_HISTORY = 8
const HISTORY_PAGE_SIZE = 32
const MAX_HISTORY_PAGES = 8

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

export async function loadRecentHistory(
  searchPage: (endTime?: number) => Promise<RecentHistoryEntry[]>,
): Promise<RecentHistoryRow[]> {
  const rows: RecentHistoryRow[] = []
  const seenIds = new Set<string>()
  let endTime: number | undefined

  for (let pageNumber = 0; pageNumber < MAX_HISTORY_PAGES; pageNumber += 1) {
    const items = await searchPage(endTime)
    if (items.length === 0) break

    const oldestTime = items.reduce<number | undefined>(
      (oldest, item) =>
        typeof item.lastVisitTime === 'number' &&
        (oldest === undefined || item.lastVisitTime < oldest)
          ? item.lastVisitTime
          : oldest,
      undefined,
    )

    for (const row of selectRecentHistory(items)) {
      if (seenIds.has(row.id)) continue
      seenIds.add(row.id)
      rows.push(row)
      if (rows.length === MAX_RECENT_HISTORY) return rows
    }

    if (items.length < HISTORY_PAGE_SIZE || oldestTime === undefined) break
    if (endTime !== undefined && oldestTime >= endTime) break
    endTime = oldestTime
  }

  return rows
}
