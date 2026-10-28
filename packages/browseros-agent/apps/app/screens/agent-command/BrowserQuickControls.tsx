import {
  Camera,
  Download,
  ExternalLink,
  Globe2,
  RotateCw,
  History,
  Puzzle,
  Settings2,
  SquarePlus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { resolveHomeSearchUrl } from './home-search'

type DownloadRow = {
  id: number
  filename: string
  state: string
  receivedBytes: number
  totalBytes: number
}

export function BrowserQuickControls() {
  const [address, setAddress] = useState('')
  const [webTabs, setWebTabs] = useState<{ id: number; title: string }[]>([])
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null)
  const [downloads, setDownloads] = useState<DownloadRow[]>([])
  const [history, setHistory] = useState<{ id: string; title: string; url: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [privateWindow, setPrivateWindow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [lastActivationAckMs, setLastActivationAckMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDownloads, setShowDownloads] = useState(false)

  useEffect(() => {
    let active = true
    void chrome.windows.getCurrent().then((window) => {
      if (active) setPrivateWindow(Boolean(window.incognito))
    }).catch(() => {
      if (active) setPrivateWindow(true)
    })
    return () => {
      active = false
    }
  }, [])

  const refreshWebTabs = async () => {
    const allTabs = await chrome.tabs.query({ currentWindow: true })
    const web = allTabs.flatMap((tab) =>
      tab.id !== undefined && (tab.url?.startsWith('https://') || tab.url?.startsWith('http://'))
        ? [{ id: tab.id, title: tab.title || tab.url || 'Webpage' }]
        : [],
    ).slice(0, 50)
    setWebTabs(web)
    setSelectedTabId((previous) =>
      previous !== null && web.some((tab) => tab.id === previous)
        ? previous : (web[0]?.id ?? null),
    )
  }

  useEffect(() => {
    void refreshWebTabs().catch(() => undefined)
  }, [])

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
      const target = tabs.find((tab) =>
        tab.id === selectedTabId && (tab.url?.startsWith('https://') || tab.url?.startsWith('http://')),
      )
      if (target?.id === undefined) throw new Error('Website tab moved or closed')
      await chrome.tabs.reload(target.id)
    })
  }

  const activateWebTab = () => {
    void action(async () => {
      if (selectedTabId === null) throw new Error('Select a website first')
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const target = tabs.find((tab) => tab.id === selectedTabId && tab.url?.startsWith('http'))
      if (target?.id === undefined) throw new Error('Tab no longer available')
      const start = performance.now()
      await chrome.tabs.update(target.id, { active: true })
      setLastActivationAckMs(Math.round((performance.now() - start) * 100) / 100)
    })
  }

  const listDownloads = () => {
    void action(async () => {
      if (privateWindow) throw new Error('Private window')
      const recent = await chrome.downloads.search({
        limit: 8,
        orderBy: ['-startTime'],
      })
      setDownloads(recent.map((item) => ({
        id: item.id,
        filename: item.filename.split(String.fromCharCode(92)).pop()?.split('/').pop() || 'Download',
        state: item.state,
        receivedBytes: item.bytesReceived,
        totalBytes: item.totalBytes,
      })))
      setShowDownloads(true)
    })
  }

  const screenshot = () => {
    void action(async () => {
      if (privateWindow) throw new Error('Screenshot not available in private windows')
      const current = await chrome.windows.getCurrent()
      if (current.id === undefined || selectedTabId === null) {
        throw new Error('Select a website before capturing')
      }
      const tabs = await chrome.tabs.query({ currentWindow: true })
      const target = tabs.find((tab) =>
        tab.id === selectedTabId &&
        tab.windowId === current.id &&
        (tab.url?.startsWith('https://') || tab.url?.startsWith('http://')),
      )
      if (target?.id === undefined) throw new Error('Selected website not available')
      if (!window.confirm('Capture the selected website tab? It may contain private information. The image will be saved to Downloads; nothing is sent to an AI model.')) {
        return
      }
      await chrome.tabs.update(target.id, { active: true })
      const image = await chrome.tabs.captureVisibleTab(current.id, { format: 'png' })
      await chrome.downloads.download({
        url: image,
        filename: 'aster-capture-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png',
        saveAs: true,
      })
    })
  }

  const restoreClosed = () =>
    void action(async () => {
      if (privateWindow) throw new Error('Unavailable in private windows')
      const currentWindow = await chrome.windows.getCurrent()
      const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 15 })
      const lastTab = closed.find((session) =>
        session.tab?.sessionId &&
        session.tab.windowId === currentWindow.id &&
        !session.tab.incognito,
      )
      if (!lastTab?.tab?.sessionId) {
        setError('No recently closed tab in this window.')
        return
      }
      await chrome.sessions.restore(lastTab.tab.sessionId)
    })

  const showRecentHistory = () =>
    void action(async () => {
      if (privateWindow) throw new Error('Unavailable in private windows')
      const items = await chrome.history.search({
        text: '',
        startTime: 0,
        maxResults: 8,
      })
      setHistory(items.flatMap((item) =>
        item.url && (item.url.startsWith('https://') || item.url.startsWith('http://'))
          ? [{ id: item.id, title: item.title || item.url, url: item.url }]
          : [],
      ))
      setShowHistory(true)
    })

  const openExtensionsManager = () =>
    void action(async () => {
      await chrome.tabs.create({ url: 'chrome://extensions' })
    })

  const openNativeSettings = () =>
    void action(async () => {
      await chrome.tabs.create({ url: 'chrome://settings/content' })
    })

  return (
    <section className="space-y-2 rounded-xl border border-border/60 bg-card/50 p-3" aria-label="Browser quick actions">
      <div className="flex items-center gap-2 text-sm font-medium">
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
        <button disabled={busy || !address.trim()} type="submit" className="rounded-md border px-2 text-xs disabled:opacity-50">
          Open
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Choose a website tab for browser actions"
          value={selectedTabId ?? ''}
          onChange={(event) => setSelectedTabId(Number(event.currentTarget.value))}
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
        >
          {webTabs.length === 0 && <option value="">No open websites</option>}
          {webTabs.map((tab) => (
            <option key={tab.id} value={tab.id}>{tab.title}</option>
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
          { name: 'New tab', Icon: SquarePlus, run: () => void action(() => chrome.tabs.create({})) },
          { name: 'Activate selected tab', Icon: Globe2, run: activateWebTab },
          { name: 'Reload selected webpage', Icon: RotateCw, run: reload },
          { name: 'Reopen closed tab', Icon: History, run: restoreClosed },
          { name: 'Recent history', Icon: History, run: showRecentHistory },
          { name: 'Downloads', Icon: Download, run: listDownloads },
          { name: 'Screenshot', Icon: Camera, run: screenshot },
          { name: 'Website permissions', Icon: Settings2, run: openNativeSettings },
          { name: 'Extensions', Icon: Puzzle, run: openExtensionsManager },
        ].map(({ name, Icon, run }) => (
          <button
            key={name}
            type="button"
            disabled={
              busy ||
              ((name === 'Activate selected tab' || name === 'Reload selected webpage' || name === 'Screenshot') && selectedTabId === null) ||
              (privateWindow && ['Downloads', 'Screenshot', 'Reopen closed tab', 'Recent history'].includes(name))
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
      {lastActivationAckMs !== null && (
        <p className="text-muted-foreground text-xs">
          Last tab activation API acknowledgement: {lastActivationAckMs} ms.
          This is not the time to paint the tab or proof of responsive input.
        </p>
      )}
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      {showDownloads && !privateWindow && (
        <ul className="space-y-1 text-xs" aria-label="Recent downloads">
          {downloads.length === 0 ? <li>No recent downloads.</li> : downloads.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <ExternalLink aria-hidden="true" className="size-3" />
              <span className="min-w-0 flex-1 truncate" title={item.filename}>{item.filename}</span>
              <span className="shrink-0 text-muted-foreground">
                {item.state} {item.totalBytes > 0 ? Math.round(item.receivedBytes / item.totalBytes * 100) + '%' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showHistory && !privateWindow && (
        <ul className="space-y-1 text-xs" aria-label="Recent browser history">
          {history.length === 0 ? <li>No recent web history.</li> : history.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="block w-full truncate text-left underline-offset-2 hover:underline"
                title={item.url}
                onClick={() => void action(() => chrome.tabs.create({ url: item.url }))}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {privateWindow && <p className="text-muted-foreground text-xs">History, closed-tab restore and screenshots stay hidden in private windows.</p>}
    </section>
  )
}
