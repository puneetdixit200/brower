import {
  CalendarClock,
  ClipboardList,
  Globe,
  Home,
  type LucideIcon,
  PlugZap,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIsMac } from '@/lib/useIsMac'
import {
  type CommandPaletteTab,
  CurrentWindowTabs,
  filterCommandPaletteTabs,
} from './command-palette-tabs'

type PaletteDestination = {
  title: string
  description: string
  path: string
  icon: LucideIcon
}

const DESTINATIONS: readonly PaletteDestination[] = [
  {
    title: 'Home',
    description: 'Search the web or ask an agent',
    path: '/home',
    icon: Home,
  },
  {
    title: 'Task History',
    description: 'Return to previous browser tasks',
    path: '/tasks',
    icon: ClipboardList,
  },
  {
    title: 'Scheduled Tasks',
    description: 'Review and manage your routines',
    path: '/scheduled',
    icon: CalendarClock,
  },
  {
    title: 'Connect Apps',
    description: 'Configure optional external integrations',
    path: '/connect-apps',
    icon: PlugZap,
  },
  {
    title: 'AI Providers',
    description: 'Choose connected model providers',
    path: '/settings/ai',
    icon: Sparkles,
  },
  {
    title: 'Memory',
    description: 'Review, edit and delete local memories',
    path: '/settings/memory',
    icon: Search,
  },
  {
    title: 'Privacy Settings',
    description: 'Control diagnostics and data disclosure',
    path: '/settings/privacy',
    icon: ShieldCheck,
  },
  {
    title: 'Appearance Settings',
    description: 'Personalize Aster',
    path: '/settings/customization',
    icon: Settings2,
  },
]

/**
 * Quick navigation within Aster's own UI. It never fabricates tabs,
 * overrides native browser keys, or gains agent/browser privileges.
 */
export function AsterCommandPalette() {
  const navigate = useNavigate()
  const isMac = useIsMac()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [tabs, setTabs] = useState<CommandPaletteTab[]>([])
  const [tabsError, setTabsError] = useState<string | null>(null)
  const [loadingTabs, setLoadingTabs] = useState(false)
  const [activatingTabId, setActivatingTabId] = useState<number | null>(null)
  const [tabsRefresh, setTabsRefresh] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const openRef = useRef(open)
  const paletteSession = useRef(0)
  const tabsApi = useRef<CurrentWindowTabs | null>(null)
  if (!tabsApi.current) {
    tabsApi.current = new CurrentWindowTabs(
      {
        query: (queryInfo) => chrome.tabs.query(queryInfo),
        update: (tabId, updateProperties) =>
          chrome.tabs.update(tabId, updateProperties),
      },
      chrome.runtime.getURL(''),
    )
  }

  const openPalette = useCallback(() => {
    if (openRef.current) return
    paletteSession.current += 1
    openRef.current = true
    setOpen(true)
  }, [])

  const closePalette = useCallback(() => {
    paletteSession.current += 1
    openRef.current = false
    tabsApi.current?.cancelPendingQuery()
    setOpen(false)
    setTabs([])
    setTabsError(null)
    setLoadingTabs(false)
    setActivatingTabId(null)
  }, [])

  const isOnboarding = location.pathname.startsWith('/onboarding')
  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (
        !event.repeat &&
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k' &&
        !isOnboarding
      ) {
        event.preventDefault()
        if (openRef.current) closePalette()
        else openPalette()
      }
    }
    function onOpenCommandPalette() {
      if (!isOnboarding) openPalette()
    }
    window.addEventListener('keydown', onShortcut)
    window.addEventListener('aster:open-command-palette', onOpenCommandPalette)
    return () => {
      window.removeEventListener('keydown', onShortcut)
      window.removeEventListener(
        'aster:open-command-palette',
        onOpenCommandPalette,
      )
    }
  }, [closePalette, isOnboarding, openPalette])

  useEffect(() => {
    if (isOnboarding) closePalette()
  }, [closePalette, isOnboarding])

  useEffect(() => {
    openRef.current = open
    void tabsRefresh
    if (!open) return
    const currentTabsApi = tabsApi.current
    if (!currentTabsApi) return

    let current = true
    setLoadingTabs(true)
    setTabsError(null)
    void currentTabsApi
      .query()
      .then((result) => {
        if (!current || !result) return
        setTabs(result)
        setLoadingTabs(false)
      })
      .catch(() => {
        if (!current) return
        setTabsError('Could not load tabs. Retry to refresh the list.')
        setLoadingTabs(false)
      })

    return () => {
      current = false
      currentTabsApi.cancelPendingQuery()
    }
  }, [open, tabsRefresh])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else {
      setQuery('')
      setSelected(0)
    }
  }, [open])

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return DESTINATIONS
    return DESTINATIONS.filter((entry) =>
      `${entry.title} ${entry.description}`.toLocaleLowerCase().includes(term),
    )
  }, [query])

  const tabResults = useMemo(
    () => filterCommandPaletteTabs(tabs, query),
    [tabs, query],
  )
  const resultCount = results.length + tabResults.length

  useEffect(() => {
    setSelected((previous) => Math.min(previous, Math.max(resultCount - 1, 0)))
  }, [resultCount])

  const go = (destination: PaletteDestination) => {
    closePalette()
    navigate(destination.path)
  }

  const activateTab = async (tabId: number) => {
    if (activatingTabId !== null) return
    const session = paletteSession.current
    setActivatingTabId(tabId)
    setTabsError(null)
    try {
      await tabsApi.current?.activate(tabId)
      if (session === paletteSession.current && openRef.current) closePalette()
    } catch {
      if (session !== paletteSession.current || !openRef.current) return
      setActivatingTabId(null)
      setTabsError(
        'Could not switch to that tab. It may have closed; refresh the list and try again.',
      )
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (activatingTabId !== null) return
      event.preventDefault()
      setSelected((previous) => (previous + 1) % Math.max(resultCount, 1))
    } else if (event.key === 'ArrowUp') {
      if (activatingTabId !== null) return
      event.preventDefault()
      setSelected(
        (previous) => (previous - 1 + resultCount) % Math.max(resultCount, 1),
      )
    } else if (event.key === 'Enter' && resultCount > 0) {
      if (activatingTabId !== null) return
      event.preventDefault()
      if (results[selected]) go(results[selected])
      else {
        const tab = tabResults[selected - results.length]
        if (tab) void activateTab(tab.id)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? openPalette() : closePalette())}
    >
      <DialogContent className="max-w-lg gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>Jump to Aster</DialogTitle>
          <DialogDescription>
            Search pages, settings, and tabs in this window.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border px-3">
          <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setSelected(0)
            }}
            onKeyDown={handleKeyDown}
            aria-label="Find an Aster page"
            aria-controls="aster-command-results"
            aria-activedescendant={
              results[selected]
                ? `aster-command-${selected}`
                : tabResults[selected - results.length]
                  ? `aster-tab-${tabResults[selected - results.length]?.id}`
                  : undefined
            }
            placeholder="Find tasks, memory, providers…"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
          />
        </div>
        <div
          id="aster-command-results"
          role="listbox"
          aria-label="Pages and tabs"
          className="max-h-[min(55vh,390px)] space-y-1 overflow-y-auto"
        >
          {results.length === 0 &&
          tabResults.length === 0 &&
          !loadingTabs &&
          !tabsError ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              No matching pages or tabs.
            </p>
          ) : (
            <>
              {results.length > 0 && (
                <p className="px-3 pt-2 text-muted-foreground text-xs">Pages</p>
              )}
              {results.map((destination, index) => {
                const Icon = destination.icon
                return (
                  <button
                    key={destination.path}
                    id={`aster-command-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected === index}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => go(destination)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring ${
                      selected === index ? 'bg-accent' : 'hover:bg-accent/60'
                    }`}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {destination.title}
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {destination.description}
                      </span>
                    </span>
                  </button>
                )
              })}
              {(tabResults.length > 0 || loadingTabs) && (
                <p className="px-3 pt-2 text-muted-foreground text-xs">
                  Tabs in this window
                </p>
              )}
              {loadingTabs && (
                <p
                  role="status"
                  className="px-3 py-2 text-muted-foreground text-sm"
                >
                  Loading tabs…
                </p>
              )}
              {tabResults.map((tab, index) => {
                const resultIndex = results.length + index
                const label = tab.title?.trim() || tab.url || `Tab ${tab.id}`
                return (
                  <button
                    key={tab.id}
                    id={`aster-tab-${tab.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected === resultIndex}
                    disabled={activatingTabId !== null}
                    onMouseEnter={() => setSelected(resultIndex)}
                    onClick={() => void activateTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 ${
                      selected === resultIndex
                        ? 'bg-accent'
                        : 'hover:bg-accent/60'
                    }`}
                  >
                    <Globe aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {label}
                      </span>
                      {tab.title && tab.url && (
                        <span className="block truncate text-muted-foreground text-xs">
                          {tab.url}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
              {tabsError && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 px-3 py-2 text-destructive text-sm"
                >
                  <span>{tabsError}</span>
                  <button
                    type="button"
                    className="shrink-0 underline"
                    onClick={() => setTabsRefresh((previous) => previous + 1)}
                  >
                    Refresh tabs
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <p className="text-right text-muted-foreground text-xs">
          {isMac ? '⌘+Option+K' : 'Ctrl+Alt+K'} to toggle · Enter to open · Esc
          to close
        </p>
      </DialogContent>
    </Dialog>
  )
}
