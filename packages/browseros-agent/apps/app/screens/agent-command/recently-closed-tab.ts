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
  if (
    currentWindowId === undefined ||
    !Number.isSafeInteger(currentWindowId) ||
    currentWindowId <= 0
  ) {
    return undefined
  }

  const sessionIdCounts = new Map<string, number>()
  for (const session of sessions) {
    const sessionId = session.tab?.sessionId
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      sessionIdCounts.set(sessionId, (sessionIdCounts.get(sessionId) ?? 0) + 1)
    }
  }

  return sessions.find((session) => {
    const tab = session.tab
    return (
      typeof tab?.sessionId === 'string' &&
      tab.sessionId.length > 0 &&
      sessionIdCounts.get(tab.sessionId) === 1 &&
      Number.isSafeInteger(tab.windowId) &&
      tab.windowId !== 0 &&
      tab.windowId === currentWindowId &&
      tab.incognito === false
    )
  })?.tab?.sessionId
}
