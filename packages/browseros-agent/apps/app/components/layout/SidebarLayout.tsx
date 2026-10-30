import { Menu } from 'lucide-react'
import type {
  CSSProperties,
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { RpcClientProvider } from '@/lib/rpc/RpcClientProvider'
import { cn } from '@/lib/utils'
import { ActiveConversationProvider } from '@/modules/conversations/active-conversation-context'
import { ShortcutsDialog } from '@/screens/newtab/index/ShortcutsDialog'
import {
  boundedSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  keyboardSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  shouldCollapseSidebarAfterResize,
} from './sidebar-resize'

const COLLAPSE_DELAY = 150
const SIDEBAR_WIDTH_KEY = 'aster.sidebar.expandedWidth.v1'
function readSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    return saved === null
      ? DEFAULT_SIDEBAR_WIDTH
      : boundedSidebarWidth(Number(saved))
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

function saveSidebarWidth(value: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(boundedSidebarWidth(value)))
  } catch {
    // Resizing still works when this profile disables local storage.
  }
}

const SidebarLayoutContent: FC = () => {
  const location = useLocation()
  const isChatPage = location.pathname === '/home/chat'
  const isHomePage = location.pathname === '/home'
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedWidth, setExpandedWidth] = useState(readSidebarWidth)
  const resizeSession = useRef<{
    initialX: number
    initialWidth: number
  } | null>(null)
  const lastResizeWidth = useRef(expandedWidth)
  const [resizing, setResizing] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openShortcuts = useCallback(() => {
    setShortcutsDialogOpen(true)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [])

  useEffect(() => {
    return () => {
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current)
      }
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current)
      collapseTimeoutRef.current = null
    }
    setSidebarOpen(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (resizeSession.current) return
    collapseTimeoutRef.current = setTimeout(() => {
      // Keyboard focus keeps the rail open even when the pointer leaves it.
      if (!sidebarRef.current?.contains(document.activeElement))
        setSidebarOpen(false)
    }, COLLAPSE_DELAY)
  }, [])

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current)
      collapseTimeoutRef.current = null
    }
    resizeSession.current = {
      initialX: event.clientX,
      initialWidth: expandedWidth,
    }
    lastResizeWidth.current = expandedWidth
    setSidebarOpen(true)
    setResizing(true)
  }

  useEffect(() => {
    if (!resizing) return
    const onMove = (event: PointerEvent) => {
      const session = resizeSession.current
      if (!session) return
      const next = boundedSidebarWidth(
        session.initialWidth + event.clientX - session.initialX,
      )
      lastResizeWidth.current = next
      setExpandedWidth(next)
    }
    const onStop = (event: PointerEvent | Event) => {
      const session = resizeSession.current
      if (!session) return
      const next =
        event instanceof PointerEvent
          ? boundedSidebarWidth(
              session.initialWidth + event.clientX - session.initialX,
            )
          : lastResizeWidth.current
      resizeSession.current = null
      setResizing(false)
      setExpandedWidth(next)
      saveSidebarWidth(next)
      if (
        event instanceof PointerEvent &&
        shouldCollapseSidebarAfterResize(
          sidebarRef.current?.getBoundingClientRect(),
          { x: event.clientX, y: event.clientY },
          Boolean(sidebarRef.current?.contains(document.activeElement)),
          next,
        )
      ) {
        handleMouseLeave()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onStop)
    window.addEventListener('pointercancel', onStop)
    window.addEventListener('blur', onStop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onStop)
      window.removeEventListener('pointercancel', onStop)
      window.removeEventListener('blur', onStop)
    }
  }, [handleMouseLeave, resizing])

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = keyboardSidebarWidth(expandedWidth, event.key)
    if (next === null) return
    event.preventDefault()
    lastResizeWidth.current = next
    setExpandedWidth(next)
    saveSidebarWidth(next)
  }

  if (isMobile) {
    return (
      <RpcClientProvider>
        <div
          className={cn(
            'flex flex-col bg-background',
            isChatPage ? 'h-dvh' : 'min-h-screen',
          )}
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 size-7"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="size-4" />
            </Button>
            <span className="font-semibold">Aster Browser</span>
          </header>
          {isChatPage ? (
            <main className="relative min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          ) : isHomePage ? (
            <main className="flex-1 overflow-y-auto">
              <Outlet />
            </main>
          ) : (
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <Outlet />
              </div>
            </main>
          )}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-72 p-0">
              <AppSidebar
                expanded
                onOpenShortcuts={openShortcuts}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>
          <ShortcutsDialog
            open={shortcutsDialogOpen}
            onOpenChange={setShortcutsDialogOpen}
          />
        </div>
      </RpcClientProvider>
    )
  }

  return (
    <RpcClientProvider>
      {/* pl-14 offsets all content by the collapsed sidebar width (w-14 = 56px) so it never sits under the rail */}
      <div className="relative min-h-screen bg-background pl-14">
        {/* Sidebar - fixed overlay */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: hover interactions needed */}
        <div
          ref={sidebarRef}
          className="fixed inset-y-0 left-0 z-40"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocusCapture={handleMouseEnter}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              !event.currentTarget.matches(':hover')
            )
              handleMouseLeave()
          }}
        >
          <AppSidebar
            expanded={sidebarOpen}
            expandedWidth={expandedWidth}
            onOpenShortcuts={openShortcuts}
          />
          {sidebarOpen && (
            <hr
              aria-orientation="vertical"
              aria-label="Resize Aster sidebar"
              aria-valuemin={MIN_SIDEBAR_WIDTH}
              aria-valuemax={MAX_SIDEBAR_WIDTH}
              aria-valuenow={expandedWidth}
              tabIndex={0}
              onPointerDown={beginResize}
              onKeyDown={resizeWithKeyboard}
              className="absolute inset-y-0 right-0 w-2 cursor-col-resize border-0 bg-transparent hover:bg-border/70 focus-visible:bg-ring/50 focus-visible:outline-2 focus-visible:outline-ring"
            />
          )}
        </div>

        {isChatPage ? (
          // The expanded rail adds 200px beyond the 56px already reserved.
          // Keep the transcript readable while browsing history in narrow windows.
          <main
            className={cn(
              'relative h-dvh overflow-hidden transition-[margin] duration-200',
              sidebarOpen && 'ml-[var(--aster-sidebar-extra)]',
            )}
            style={
              {
                '--aster-sidebar-extra': `${expandedWidth - 56}px`,
              } as CSSProperties
            }
          >
            <Outlet />
          </main>
        ) : isHomePage ? (
          <main className="min-h-screen overflow-y-auto">
            <Outlet />
          </main>
        ) : (
          <main className="min-h-screen overflow-y-auto">
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
        )}
      </div>
      <ShortcutsDialog
        open={shortcutsDialogOpen}
        onOpenChange={setShortcutsDialogOpen}
      />
    </RpcClientProvider>
  )
}

export const SidebarLayout: FC = () => (
  <ActiveConversationProvider>
    <SidebarLayoutContent />
  </ActiveConversationProvider>
)
