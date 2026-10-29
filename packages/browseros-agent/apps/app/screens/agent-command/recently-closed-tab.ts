type RecentlyClosedTabEntry = {
  window?: unknown
  tab?: {
    sessionId?: string
    windowId?: number
    incognito?: boolean
  }
}

export function selectRecentlyClosedTabSessionId(
  sessions: RecentlyClosedTabEntry[],
  currentWindowId: number | undefined,
): string | undefined {
  if (currentWindowId === undefined) return undefined

  return sessions.find(
    (session) =>
      session.tab?.sessionId &&
      session.tab.windowId === currentWindowId &&
      !session.tab.incognito,
  )?.tab?.sessionId
}
