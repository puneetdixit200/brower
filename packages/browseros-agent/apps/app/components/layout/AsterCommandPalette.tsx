import {
  CalendarClock,
  ClipboardList,
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
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useIsMac } from '@/lib/useIsMac'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
  const inputRef = useRef<HTMLInputElement>(null)

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
        setOpen((previous) => !previous)
      }
    }
    function onOpenCommandPalette() {
      if (!isOnboarding) setOpen(true)
    }
    window.addEventListener('keydown', onShortcut)
    window.addEventListener('aster:open-command-palette', onOpenCommandPalette)
    return () => {
      window.removeEventListener('keydown', onShortcut)
      window.removeEventListener('aster:open-command-palette', onOpenCommandPalette)
    }
  }, [isOnboarding])

  useEffect(() => {
    if (isOnboarding) setOpen(false)
  }, [isOnboarding])

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
      (entry.title + ' ' + entry.description)
        .toLocaleLowerCase()
        .includes(term),
    )
  }, [query])

  const go = (destination: PaletteDestination) => {
    setOpen(false)
    navigate(destination.path)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((previous) => (previous + 1) % Math.max(results.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(
        (previous) => (previous - 1 + results.length) % Math.max(results.length, 1),
      )
    } else if (event.key === 'Enter' && results[selected]) {
      event.preventDefault()
      go(results[selected])
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>Jump to Aster</DialogTitle>
          <DialogDescription>
            Search pages and settings. This searches Aster navigation only.
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
              results[selected] ? 'aster-command-' + selected : undefined
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
          aria-label="Aster navigation destinations"
          className="max-h-[min(55vh,390px)] space-y-1 overflow-y-auto"
        >
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              No matching Aster pages.
            </p>
          ) : (
            results.map((destination, index) => {
              const Icon = destination.icon
              return (
                <button
                  key={destination.path}
                  id={'aster-command-' + index}
                  type="button"
                  role="option"
                  aria-selected={selected === index}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => go(destination)}
                  className={
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring ' +
                    (selected === index ? 'bg-accent' : 'hover:bg-accent/60')
                  }
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{destination.title}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {destination.description}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
        <p className="text-right text-muted-foreground text-xs">
          {isMac ? '⌘+Option+K' : 'Ctrl+Alt+K'} to toggle · Enter to open · Esc to close
        </p>
      </DialogContent>
    </Dialog>
  )
}
