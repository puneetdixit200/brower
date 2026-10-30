import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Download,
  ExternalLink,
  Globe2,
  History,
  Pause,
  Play,
  Puzzle,
  RotateCw,
  Settings2,
  Square,
  SquarePlus,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  navigateSelectedWebTab,
  stopSelectedWebTabLoading,
} from './browser-navigation-actions'
import {
  canControlDownload,
  createPendingDownloadUpdates,
  type DownloadAction,
  type DownloadProgressRow,
  type DownloadProgressUpdate,
  downloadFailureMessage,
  downloadRowFromItem,
  mergeDownloadSnapshot,
  mergeDownloadUpdate,
  performDownloadAction,
} from './downloads-progress'
import { loadRecentHistory, RECENT_HISTORY_QUERY_LIMIT } from './history-items'
import { resolveHomeSearchUrl } from './home-search'
import { selectRecentlyClosedTabSessionId } from './recently-closed-tab'
import { captureVisibleTabContext } from './screenshot-context'
import { openWebsitePermissions } from './website-permissions'

export function BrowserQuickControls({
  onScreenshotContext,
  screenshotContextEnabled = true,
}: {
  onScreenshotContext?: (dataUrl: string) => void
  screenshotContextEnabled?: boolean
}) {
  const [address, setAddress] = useState('')
  const [webTabs, setWebTabs] = useState<{ id: number; title: string }[]>([])
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null)
  const [downloads, setDownloads] = useState<DownloadProgressRow[]>([])
  const [downloadActionErrors, setDownloadActionErrors] = useState<
    Record<number, string>
  >({})
  const [history, setHistory] = useState<
    { id: string; title: string; url: string }[]
  >([])
  const [showHistory, setShowHistory] = useState(false)
  const [privateWindow, setPrivateWindow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [lastActivationAckMs, setLastActivationAckMs] = useState<number | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [showDownloads, setShowDownloads] = useState(false)
  const [contextShot, setContextShot] = useState<string | null>(null)
  const [lasso, setLasso] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(
    null,
  )
  const contextShotPreview = useRef<HTMLImageElement>(null)
  const downloadActionsInFlight = useRef(new Set<number>())

  useEffect(() => {
    let active = true
    void chrome.windows
      .getCurrent()
      .then((window) => {
        if (active) setPrivateWindow(Boolean(window.incognito))
      })
      .catch(() => {
        if (active) setPrivateWindow(true)
      })
    return () => {
      active = false
    }
  }, [])

  const refreshWebTabs = useCallback(async () => {
    const allTabs = await chrome.tabs.query({ currentWindow: true })
    const web = allTabs
      .flatMap((tab) =>
        tab.id !== undefined &&
        (tab.url?.startsWith('https://') || tab.url?.startsWith('http://'))
          ? [{ id: tab.id, title: tab.title || tab.url || 'Webpage' }]
          : [],
      )
      .slice(0, 50)
    setWebTabs(web)
    setSelectedTabId((previous) =>
      previous !== null && web.some((tab) => tab.id === previous)
        ? previous
        : (web[0]?.id ?? null),
    )
  }, [])

  useEffect(() => {
    void refreshWebTabs().catch(() => undefined)
  }, [refreshWebTabs])

  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch {
      setError('The browser could not complete that action.')
    } finally {
      setBusy(false)
    }
  }

  const openAddress = () => {
    void action(async () => {
      const url = resolveHomeSearchUrl(address)
      if (!url) throw new Error('Invalid address')
      await chrome.tabs.create({ url })
      setAddress('')
    })
  }

  const reload = () => {
    void action(async () => {
      if (selectedTabId === null) throw new Error('Select a website first')
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const target = tabs.find(
        (tab) =>
          tab.id === selectedTabId &&
          (tab.url?.startsWith('https://') || tab.url?.startsWith('http://')),
      )
      if (target?.id === undefined)
        throw new Error('Website tab moved or closed')
      await chrome.tabs.reload(target.id)
    })
  }

  const navigateSelected = (direction: 'back' | 'forward') => {
    void action(() =>
      navigateSelectedWebTab(chrome.tabs, selectedTabId, direction),
    )
  }

  const stopSelectedLoading = () => {
    void action(() =>
      stopSelectedWebTabLoading(
        {
          query: (queryInfo) => chrome.tabs.query(queryInfo),
          stopTabLoading: (tabId) => chrome.browserOS.stopTabLoading(tabId),
        },
        selectedTabId,
      ),
    )
  }

  const activateWebTab = () => {
    void action(async () => {
      if (selectedTabId === null) throw new Error('Select a website first')
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const target = tabs.find(
        (tab) => tab.id === selectedTabId && tab.url?.startsWith('http'),
      )
      if (target?.id === undefined) throw new Error('Tab no longer available')
      const start = performance.now()
      await chrome.tabs.update(target.id, { active: true })
      setLastActivationAckMs(
        Math.round((performance.now() - start) * 100) / 100,
      )
    })
  }

  const listDownloads = () => {
    if (privateWindow) return
    setError(null)
    setShowDownloads(true)
  }

  useEffect(() => {
    if (!showDownloads || privateWindow) return
    let active = true
    const pendingUpdates = createPendingDownloadUpdates()
    const latestRefreshById = new Map<number, number>()
    let refreshSequence = 0
    const applyUpdate = (update: DownloadProgressUpdate) => {
      pendingUpdates.add(update)
      setDownloads((current) => mergeDownloadUpdate(current, update))
    }
    const onCreated = (item: chrome.downloads.DownloadItem) => {
      if (item.incognito !== false) return
      applyUpdate(downloadRowFromItem(item))
    }
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      const sequence = ++refreshSequence
      latestRefreshById.set(delta.id, sequence)
      void chrome.downloads
        .search({ id: delta.id })
        .then((items) => {
          if (!active || latestRefreshById.get(delta.id) !== sequence) return
          const item = items[0]
          if (item?.incognito === false) applyUpdate(downloadRowFromItem(item))
        })
        .catch(() => undefined)
    }
    chrome.downloads.onCreated.addListener(onCreated)
    chrome.downloads.onChanged.addListener(onChanged)
    void chrome.downloads
      .search({ limit: 8, orderBy: ['-startTime'] })
      .then((recent) => {
        if (!active) return
        setDownloads(
          mergeDownloadSnapshot(
            recent
              .filter((item) => item.incognito === false)
              .map(downloadRowFromItem),
            pendingUpdates.settle(),
          ),
        )
      })
      .catch(() => {
        if (active) {
          pendingUpdates.settle()
          setError('Could not load recent downloads.')
        }
      })
    return () => {
      active = false
      chrome.downloads.onCreated.removeListener(onCreated)
      chrome.downloads.onChanged.removeListener(onChanged)
    }
  }, [privateWindow, showDownloads])

  const controlDownload = (id: number, operation: DownloadAction) => {
    if (busy || downloadActionsInFlight.current.has(id)) return
    downloadActionsInFlight.current.add(id)
    setDownloadActionErrors((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    void (async () => {
      try {
        const updated = await performDownloadAction(
          chrome.downloads,
          () => chrome.windows.getCurrent(),
          privateWindow,
          id,
          operation,
        )
        if (!updated && operation === 'cancel') {
          setDownloads((rows) => rows.filter((row) => row.id !== id))
          return
        }
        if (!updated) return
        setDownloads((rows) =>
          mergeDownloadUpdate(rows, downloadRowFromItem(updated)),
        )
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : 'The browser could not update this download.'
        setDownloadActionErrors((current) => ({ ...current, [id]: message }))
      } finally {
        downloadActionsInFlight.current.delete(id)
      }
    })()
  }

  const screenshot = () => {
    void action(async () => {
      if (privateWindow)
        throw new Error('Screenshot not available in private windows')
      const current = await chrome.windows.getCurrent()
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const image = await captureVisibleTabContext({
        windowId: current.id,
        selectedTabId,
        tabs,
        confirm: () =>
          window.confirm(
            'Capture the selected website tab? It may contain private information. The image will be saved to Downloads; nothing is sent to an AI model.',
          ),
        activateAndVerify: async (windowId, tabId) => {
          const target = await chrome.tabs.get(tabId)
          if (
            target.windowId !== windowId ||
            !(
              target.url?.startsWith('https://') ||
              target.url?.startsWith('http://')
            )
          ) {
            return false
          }
          await chrome.tabs.update(tabId, { active: true })
          const [activeTab] = await chrome.tabs.query({
            active: true,
            windowId,
          })
          return (
            activeTab?.id === tabId &&
            activeTab.windowId === windowId &&
            Boolean(
              activeTab.url?.startsWith('https://') ||
                activeTab.url?.startsWith('http://'),
            )
          )
        },
        capture: async (windowId) =>
          chrome.tabs.captureVisibleTab(windowId, { format: 'png' }),
        verifyActive: async (windowId, tabId) => {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            windowId,
          })
          return (
            activeTab?.id === tabId &&
            activeTab.windowId === windowId &&
            Boolean(
              activeTab.url?.startsWith('https://') ||
                activeTab.url?.startsWith('http://'),
            )
          )
        },
      })
      if (!image) return
      await chrome.downloads.download({
        url: image,
        filename:
          'aster-capture-' +
          new Date().toISOString().replace(/[:.]/g, '-') +
          '.png',
        saveAs: true,
      })
    })
  }

  const screenshotForContext = () => {
    void action(async () => {
      if (privateWindow)
        throw new Error('Screenshot context is unavailable in private windows')
      const current = await chrome.windows.getCurrent()
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const image = await captureVisibleTabContext({
        windowId: current.id,
        selectedTabId,
        tabs,
        confirm: () =>
          window.confirm(
            'Capture the selected website tab for an AI message? The image stays in this draft until you submit it.',
          ),
        activateAndVerify: async (windowId, tabId) => {
          const target = await chrome.tabs.get(tabId)
          if (
            target.windowId !== windowId ||
            !(
              target.url?.startsWith('https://') ||
              target.url?.startsWith('http://')
            )
          ) {
            return false
          }
          await chrome.tabs.update(tabId, { active: true })
          const [activeTab] = await chrome.tabs.query({
            active: true,
            windowId,
          })
          return (
            activeTab?.id === tabId &&
            activeTab.windowId === windowId &&
            Boolean(
              activeTab.url?.startsWith('https://') ||
                activeTab.url?.startsWith('http://'),
            )
          )
        },
        capture: async (windowId, _tabId) => {
          return chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
        },
        verifyActive: async (windowId, tabId) => {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            windowId,
          })
          return (
            activeTab?.id === tabId &&
            activeTab.windowId === windowId &&
            Boolean(
              activeTab.url?.startsWith('https://') ||
                activeTab.url?.startsWith('http://'),
            )
          )
        },
      })
      if (!image) return
      setContextShot(image)
      setLasso(null)
    })
  }

  const attachLasso = async () => {
    if (!contextShot || !lasso || lasso.width < 4 || lasso.height < 4) return
    const image = new Image()
    image.src = contextShot
    await image.decode()
    const preview = contextShotPreview.current?.getBoundingClientRect()
    const scaleX = image.naturalWidth / (preview?.width || image.naturalWidth)
    const scaleY =
      image.naturalHeight / (preview?.height || image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(lasso.width * scaleX)
    canvas.height = Math.round(lasso.height * scaleY)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not crop screenshot')
    context.drawImage(
      image,
      lasso.x * scaleX,
      lasso.y * scaleY,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    onScreenshotContext?.(canvas.toDataURL('image/png'))
    setContextShot(null)
    setLasso(null)
  }

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    }
  }

  const restoreClosed = () =>
    void action(async () => {
      if (privateWindow) throw new Error('Unavailable in private windows')
      const currentWindow = await chrome.windows.getCurrent()
      const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 15 })
      const sessionId = selectRecentlyClosedTabSessionId(
        closed,
        currentWindow.id,
      )
      if (!sessionId) {
        setError('No recently closed tab in this window.')
        return
      }
      await chrome.sessions.restore(sessionId)
    })

  const showRecentHistory = () =>
    void action(async () => {
      if (privateWindow) throw new Error('Unavailable in private windows')
      setHistory(
        await loadRecentHistory(() =>
          chrome.history.search({
            text: '',
            startTime: 0,
            maxResults: RECENT_HISTORY_QUERY_LIMIT,
          }),
        ),
      )
      setShowHistory(true)
    })

  const openExtensionsManager = () =>
    void action(async () => {
      await chrome.tabs.create({ url: 'chrome://extensions' })
    })

  const openNativeSettings = () =>
    void action(() => openWebsitePermissions(chrome.tabs, selectedTabId))

  return (
    <section
      className="space-y-2 rounded-xl border border-border/60 bg-card/50 p-3"
      aria-label="Browser quick actions"
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        <Globe2 aria-hidden="true" className="size-4" />
        Browser actions
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          openAddress()
        }}
      >
        <input
          type="text"
          value={address}
          onChange={(event) => setAddress(event.currentTarget.value)}
          placeholder="Open URL or search"
          aria-label="Open URL or search in new tab"
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
        />
        <button
          disabled={busy || !address.trim()}
          type="submit"
          className="rounded-md border px-2 text-xs disabled:opacity-50"
        >
          Open
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Choose a website tab for browser actions"
          value={selectedTabId ?? ''}
          onChange={(event) =>
            setSelectedTabId(Number(event.currentTarget.value))
          }
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
        >
          {webTabs.length === 0 && <option value="">No open websites</option>}
          {webTabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border px-2 py-2 text-xs disabled:opacity-50"
          onClick={() => void action(refreshWebTabs)}
        >
          Refresh tabs
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {[
          {
            name: 'New tab',
            Icon: SquarePlus,
            run: () => void action(() => chrome.tabs.create({})),
          },
          { name: 'Activate selected tab', Icon: Globe2, run: activateWebTab },
          {
            name: 'Back selected webpage',
            Icon: ArrowLeft,
            run: () => navigateSelected('back'),
          },
          {
            name: 'Forward selected webpage',
            Icon: ArrowRight,
            run: () => navigateSelected('forward'),
          },
          { name: 'Reload selected webpage', Icon: RotateCw, run: reload },
          {
            name: 'Stop selected webpage loading',
            Icon: Square,
            run: stopSelectedLoading,
          },
          { name: 'Reopen closed tab', Icon: History, run: restoreClosed },
          { name: 'Recent history', Icon: History, run: showRecentHistory },
          {
            name: showDownloads ? 'Close downloads' : 'Downloads',
            Icon: Download,
            run: () =>
              showDownloads ? setShowDownloads(false) : listDownloads(),
          },
          { name: 'Screenshot', Icon: Camera, run: screenshot },
          {
            name: 'Select screenshot context',
            Icon: Camera,
            run: screenshotForContext,
          },
          {
            name: 'Website permissions for selected site',
            Icon: Settings2,
            run: openNativeSettings,
          },
          { name: 'Extensions', Icon: Puzzle, run: openExtensionsManager },
        ].map(({ name, Icon, run }) => (
          <button
            key={name}
            type="button"
            disabled={
              busy ||
              (name === 'Select screenshot context' &&
                !screenshotContextEnabled) ||
              (name === 'Website permissions for selected site' &&
                selectedTabId === null) ||
              ((name === 'Activate selected tab' ||
                name === 'Back selected webpage' ||
                name === 'Forward selected webpage' ||
                name === 'Reload selected webpage' ||
                name === 'Stop selected webpage loading' ||
                name === 'Screenshot' ||
                name === 'Select screenshot context') &&
                selectedTabId === null) ||
              (privateWindow &&
                [
                  'Downloads',
                  'Close downloads',
                  'Screenshot',
                  'Select screenshot context',
                  'Reopen closed tab',
                  'Recent history',
                ].includes(name))
            }
            onClick={run}
            aria-label={name}
            title={name}
            className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {name}
          </button>
        ))}
      </div>
      {contextShot && (
        <fieldset className="space-y-2 rounded-md border p-2">
          <legend className="sr-only">Select screenshot area</legend>
          <p className="text-xs">
            Drag a rectangle around the area to attach. It stays in the composer
            until you submit.
          </p>
          <div
            className="relative inline-block max-w-full touch-none select-none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              const p = point(event)
              setDragOrigin(p)
              setLasso({ ...p, width: 0, height: 0 })
            }}
            onPointerMove={(event) => {
              if (!dragOrigin) return
              const p = point(event)
              setLasso({
                x: Math.min(dragOrigin.x, p.x),
                y: Math.min(dragOrigin.y, p.y),
                width: Math.abs(p.x - dragOrigin.x),
                height: Math.abs(p.y - dragOrigin.y),
              })
            }}
            onPointerUp={() => setDragOrigin(null)}
          >
            <img
              ref={contextShotPreview}
              src={contextShot}
              alt="Captured selected website tab"
              className="block max-h-72 max-w-full"
            />
            {lasso && (
              <div
                className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
                style={{
                  left: lasso.x,
                  top: lasso.y,
                  width: lasso.width,
                  height: lasso.height,
                }}
              />
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-xs"
              onClick={() => {
                setContextShot(null)
                setLasso(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
              disabled={!lasso || lasso.width < 4 || lasso.height < 4}
              onClick={() =>
                void attachLasso().catch(() =>
                  setError('Could not crop the selected screenshot area.'),
                )
              }
            >
              Attach selection to draft
            </button>
          </div>
        </fieldset>
      )}
      {lastActivationAckMs !== null && (
        <p className="text-muted-foreground text-xs">
          Last tab activation API acknowledgement: {lastActivationAckMs} ms.
          This is not the time to paint the tab or proof of responsive input.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {showDownloads && !privateWindow && (
        <ul className="space-y-1 text-xs" aria-label="Recent downloads">
          {downloads.length === 0 ? (
            <li>No recent downloads.</li>
          ) : (
            downloads.map((item) => (
              <li key={item.id} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <ExternalLink aria-hidden="true" className="size-3" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={item.filename}
                  >
                    {item.filename}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.paused ? 'paused' : item.state}{' '}
                    {item.totalBytes > 0
                      ? `${Math.round(
                          (item.receivedBytes / item.totalBytes) * 100,
                        )}%`
                      : ''}
                  </span>
                  {canControlDownload(item, 'pause') && (
                    <button
                      type="button"
                      aria-label={`Pause ${item.filename}`}
                      title="Pause download"
                      className="rounded border p-1"
                      onClick={() => controlDownload(item.id, 'pause')}
                    >
                      <Pause aria-hidden="true" className="size-3" />
                    </button>
                  )}
                  {canControlDownload(item, 'resume') && (
                    <button
                      type="button"
                      aria-label={`Resume ${item.filename}`}
                      title="Resume download"
                      className="rounded border p-1"
                      onClick={() => controlDownload(item.id, 'resume')}
                    >
                      <Play aria-hidden="true" className="size-3" />
                    </button>
                  )}
                  {canControlDownload(item, 'cancel') && (
                    <button
                      type="button"
                      aria-label={`Cancel ${item.filename}`}
                      title="Cancel download"
                      className="rounded border p-1"
                      onClick={() => controlDownload(item.id, 'cancel')}
                    >
                      <X aria-hidden="true" className="size-3" />
                    </button>
                  )}
                </div>
                {(downloadActionErrors[item.id] ||
                  downloadFailureMessage(item.error)) && (
                  <p role="status" className="text-destructive">
                    {downloadActionErrors[item.id] ||
                      downloadFailureMessage(item.error)}
                  </p>
                )}
              </li>
            ))
          )}
        </ul>
      )}
      {showHistory && !privateWindow && (
        <ul className="space-y-1 text-xs" aria-label="Recent browser history">
          {history.length === 0 ? (
            <li>No recent web history.</li>
          ) : (
            history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="block w-full truncate text-left underline-offset-2 hover:underline"
                  title={item.url}
                  onClick={() =>
                    void action(() => chrome.tabs.create({ url: item.url }))
                  }
                >
                  {item.title}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {privateWindow && (
        <p className="text-muted-foreground text-xs">
          Downloads, history, closed-tab restore and screenshots stay hidden in
          private windows.
        </p>
      )}
    </section>
  )
}
