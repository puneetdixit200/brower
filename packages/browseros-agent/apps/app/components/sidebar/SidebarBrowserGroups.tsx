import { Bookmark, ChevronDown, ExternalLink, Globe2, Pin, PinOff, RefreshCw, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  type SidebarBookmark,
  type SidebarTab,
  flattenSidebarBookmarkTree,
  visibleSidebarTabs,
} from './sidebar-browser-data'
import { CurrentWindowTabs } from '../layout/command-palette-tabs'

type Section = 'tabs' | 'bookmarks'

/**
 * Read the actual browser profile, never sample data or the server's
 * conversation database. Expensive listeners/queries exist only while open.
 */
export function SidebarBrowserGroups({
  expanded,
  onNavigate,
}: {
  expanded: boolean
  onNavigate?: () => void
}) {
  const [section, setSection] = useState<Section | null>(null)
  const [tabs, setTabs] = useState<SidebarTab[]>([])
  const [bookmarks, setBookmarks] = useState<SidebarBookmark[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingTabId, setPendingTabId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const id = useId()
  const tabsApi = useRef(
    new CurrentWindowTabs(
      {
        query: (info) => chrome.tabs.query(info),
        update: (tabId, properties) => chrome.tabs.update(tabId, properties),
      },
      chrome.runtime.getURL(''),
    ),
  )
  const visible = expanded && section !== null

  useEffect(() => {
    if (!visible) return
    let active = true
    let timeout: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      setLoading(true)
      setError(null)
      try {
        if (section === 'tabs') {
          const result = await tabsApi.current.query()
          if (active && result) {
            setTabs(
              visibleSidebarTabs(result, chrome.runtime.getURL('')),
            )
          }
        } else {
          const currentWindow = await chrome.windows.getCurrent()
          if (currentWindow.incognito) {
            if (active) setBookmarks([])
            if (active) setError('Bookmarks are unavailable in private windows.')
          } else {
            const roots = await chrome.bookmarks.getTree()
            if (active) setBookmarks(flattenSidebarBookmarkTree(roots, 500))
          }
        }
      } catch {
        if (active) setError('Browser data could not be loaded. Try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    const scheduleRefresh = () => {
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(() => void refresh(), 150)
    }
    void refresh()
    if (section === 'tabs') {
      chrome.tabs.onCreated.addListener(scheduleRefresh)
      chrome.tabs.onRemoved.addListener(scheduleRefresh)
      chrome.tabs.onUpdated.addListener(scheduleRefresh)
      chrome.tabs.onActivated.addListener(scheduleRefresh)
    } else {
      chrome.bookmarks.onCreated.addListener(scheduleRefresh)
      chrome.bookmarks.onRemoved.addListener(scheduleRefresh)
      chrome.bookmarks.onChanged.addListener(scheduleRefresh)
      chrome.bookmarks.onMoved.addListener(scheduleRefresh)
    }
    return () => {
      active = false
      if (timeout) clearTimeout(timeout)
      tabsApi.current.cancelPendingQuery()
      if (section === 'tabs') {
        chrome.tabs.onCreated.removeListener(scheduleRefresh)
        chrome.tabs.onRemoved.removeListener(scheduleRefresh)
        chrome.tabs.onUpdated.removeListener(scheduleRefresh)
        chrome.tabs.onActivated.removeListener(scheduleRefresh)
      } else {
        chrome.bookmarks.onCreated.removeListener(scheduleRefresh)
        chrome.bookmarks.onRemoved.removeListener(scheduleRefresh)
        chrome.bookmarks.onChanged.removeListener(scheduleRefresh)
        chrome.bookmarks.onMoved.removeListener(scheduleRefresh)
      }
    }
  }, [section, visible, refreshToken])

  const filteredTabs = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return tabs.filter(
      (tab) =>
        !term ||
        (tab.title ?? '').toLocaleLowerCase().includes(term) ||
        (tab.url ?? '').toLocaleLowerCase().includes(term),
    )
  }, [tabs, query])
  const filteredBookmarks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return bookmarks.filter(
      (item) =>
        !term ||
        item.title.toLocaleLowerCase().includes(term) ||
        item.url.toLocaleLowerCase().includes(term) ||
        (item.folderPath ?? '').toLocaleLowerCase().includes(term),
    )
  }, [bookmarks, query])

  const activate = async (id: number) => {
    setError(null)
    try {
      await tabsApi.current.activate(id)
      onNavigate?.()
    } catch {
      setError('That tab is no longer in this window. Refresh the list.')
    }
  }

  const actOnTab = async (tab: SidebarTab & { id: number }, action: 'pin' | 'close') => {
    if (pendingTabId !== null) return
    setPendingTabId(tab.id)
    setError(null)
    try {
      // Re-check actual membership before a destructive tab action.
      const current = await chrome.tabs.query({ currentWindow: true })
      const live = current.find(
        (entry) => entry.id === tab.id &&
          !entry.url?.startsWith(chrome.runtime.getURL('')),
      )
      if (!live) throw new Error('Tab moved or closed')
      if (action === 'close') await chrome.tabs.remove(tab.id)
      else await chrome.tabs.update(tab.id, { pinned: !live.pinned })
      setRefreshToken((value) => value + 1)
    } catch {
      setError('Could not change this tab. Refresh the list and try again.')
    } finally {
      setPendingTabId(null)
    }
  }

  const openBookmark = async (bookmark: SidebarBookmark) => {
    setError(null)
    try {
      // URLs have already been scheme-checked before reaching the UI.
      await chrome.tabs.create({ url: bookmark.url })
      onNavigate?.()
    } catch {
      setError('Could not open this bookmark in a new tab.')
    }
  }

  return (
    <section className="mt-1" aria-label="Browser tabs and bookmarks">
      <div className="flex gap-1">
        {([
          { key: 'tabs', label: 'Tabs', Icon: Globe2 },
          { key: 'bookmarks', label: 'Bookmarks', Icon: Bookmark },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-expanded={visible && section === key}
            aria-controls={id}
            onClick={() => {
              setSection((previous) => (previous === key ? null : key))
              setQuery('')
            }}
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-md text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring',
              section === key && visible && 'bg-sidebar-accent',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{label}</span>
            {section === key && <ChevronDown className="size-3 shrink-0" />}
          </button>
        ))}
      </div>
      <div id={id} hidden={!visible} className="px-1 pb-2">
        <div className="mt-2 flex items-center gap-1">
          <input
            type="search"
            aria-label={section === 'bookmarks' ? 'Search bookmarks' : 'Search tabs'}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={section === 'bookmarks' ? 'Search bookmarks' : 'Search tabs'}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            aria-label="Refresh browser list"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="rounded-md p-1.5 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
        {error && <p role="alert" className="px-1 py-2 text-destructive text-xs">{error}</p>}
        {loading && <p role="status" className="px-1 py-2 text-muted-foreground text-xs">Loading…</p>}
        <ul className="styled-scrollbar mt-1 max-h-[min(24rem,40dvh)] space-y-1 overflow-y-auto">
          {section === 'tabs'
            ? filteredTabs.map((tab) => (
                <li key={tab.id} className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => tab.id !== undefined && void activate(tab.id)}
                    aria-current={tab.active ? 'page' : undefined}
                    title={tab.url}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring',
                      tab.active && 'bg-sidebar-accent',
                    )}
                  >
                    <Globe2 className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{tab.title || tab.url || 'Untitled tab'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={pendingTabId !== null}
                    aria-label={tab.pinned ? 'Unpin tab' : 'Pin tab'}
                    title={tab.pinned ? 'Unpin tab' : 'Pin tab'}
                    onClick={() => void actOnTab(tab, 'pin')}
                    className="shrink-0 rounded-md p-1 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    {tab.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    disabled={pendingTabId !== null}
                    aria-label="Close tab"
                    title="Close tab"
                    onClick={() => void actOnTab(tab, 'close')}
                    className="shrink-0 rounded-md p-1 hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))
            : filteredBookmarks.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openBookmark(item)}
                    title={item.url}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Bookmark className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      {item.folderPath && (
                        <span className="block truncate text-muted-foreground text-[10px]">
                          {item.folderPath}
                        </span>
                      )}
                    </span>
                    <ExternalLink className="size-3 shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
        </ul>
        {!loading && !error &&
          (section === 'tabs' ? filteredTabs.length === 0 : filteredBookmarks.length === 0) && (
            <p className="px-1 py-3 text-muted-foreground text-xs">
              {query ? 'No matches.' : section === 'tabs' ? 'No other tabs in this window.' : 'No web bookmarks in this profile.'}
            </p>
          )}
      </div>
    </section>
  )
}
