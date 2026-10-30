import { registerDiagnostics } from '@browseros/diagnostics/extension'
import { storage } from '@wxt-dev/storage'
import { Capabilities } from '@/lib/browseros/capabilities'
import { createConversationPanelBroker } from '@/lib/browseros/conversationPanelBroker.browser'
import {
  getAgentServerUrl,
  getHealthCheckUrl,
  getMcpServerUrl,
} from '@/lib/browseros/helpers'
import {
  initializeSidePanelOptions,
  openSidePanel,
  prepareTabSidePanel,
  toggleSidePanel,
} from '@/lib/browseros/toggleSidePanel'
import { checkAndShowChangelog } from '@/lib/changelog/changelog-notifier'
import { persistBrowserStartupRecoveryMarkers } from '@/lib/execution-history/browser-startup-recovery'
import { fetchMcpTools } from '@/lib/mcp/client'
import {
  onRuntimeMessage,
  RuntimeMessageType,
} from '@/lib/messaging/runtime/runtimeMessages'
import { onServerMessage } from '@/lib/messaging/server/serverMessages'
import { onOpenSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { searchActionsStorage } from '@/lib/search-actions/searchActionsStorage'
import { selectedTextStorage } from '@/lib/selected-text/selectedTextStorage'
import { createSerializedMutationQueue } from '@/lib/selected-text/serializedMutationQueue'
import { stopAgentStorage } from '@/lib/stop-agent/stop-agent-storage'
import { registerAddressBarSearchListener } from './address-bar-search'
import { scheduledJobRuns } from './scheduledJobRuns'

declare const __ASTER_REPORTER_EXTENSION_ID__: string

const RETIRED_STORAGE_KEYS = [
  // The unshipped Tool Approvals feature.
  'local:tool-approval-config',
  'local:pending-tool-approvals',
  'local:approval-responses',
  'local:tool-execution-log',
  // Mirrored the selected chat target, which the server now holds alone.
  'local:sidepanel-chat-target-selection',
] as const

/** Drops state belonging to features that no longer read it. */
const cleanupRetiredStorage = async () => {
  await storage.removeItems([...RETIRED_STORAGE_KEYS])
}

export default defineBackground(() => {
  registerAddressBarSearchListener(
    {
      onInputEntered: {
        addListener: (listener) =>
          chrome.omnibox.onInputEntered.addListener((text, disposition) =>
            listener(text, disposition),
          ),
      },
    },
    {
      create: (properties) => chrome.tabs.create(properties),
      update: (properties) => chrome.tabs.update(properties),
    },
  )
  registerDiagnostics(
    'browseros',
    getAgentServerUrl,
    __ASTER_REPORTER_EXTENSION_ID__,
  )
  // One background broker owns the long-lived server subscription and all
  // panel-routing effects; individual React panels can come and go freely.
  const conversationPanelBroker = createConversationPanelBroker()
  void conversationPanelBroker.start()

  // Registration never opens a panel. Per-tab URLs let panels opened by the
  // native Alt+A shortcut identify their owner without following tab switches.
  const preparePanel = (tabId: number) => {
    void prepareTabSidePanel(tabId).catch(() => undefined)
  }
  void initializeSidePanelOptions()
    .then(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id !== undefined) preparePanel(tab.id)
      }
    })
    .catch(() => undefined)
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) preparePanel(tab.id)
  })

  Capabilities.initialize().catch(() => null)

  chrome.runtime.onStartup.addListener(() => {
    const startupAt = new Date().toISOString()
    void persistBrowserStartupRecoveryMarkers(
      chrome.storage.local,
      startupAt,
    ).catch(() => undefined)
  })

  scheduledJobRuns()

  chrome.action.onClicked.addListener(async (tab) => {
    if (typeof tab.id === 'number' && typeof tab.windowId === 'number') {
      await toggleSidePanel({ tabId: tab.id, windowId: tab.windowId })
    }
  })

  onOpenSidePanelWithSearch('open', async (messageData) => {
    const currentTabsList = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    const currentTab = currentTabsList?.[0]
    if (
      typeof currentTab?.id === 'number' &&
      typeof currentTab.windowId === 'number'
    ) {
      const { opened } = await openSidePanel({
        tabId: currentTab.id,
        windowId: currentTab.windowId,
      })

      if (opened) {
        setTimeout(() => {
          searchActionsStorage.setValue(messageData.data)
        }, 500)
      }
    }
  })

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      initializeSidePanelOptions().catch(() => null)
    }

    if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
      cleanupRetiredStorage().catch(() => null)
      checkAndShowChangelog().catch(() => null)
    }
  })

  onRuntimeMessage(RuntimeMessageType.getTabId, ({ sender }) => {
    return { tabId: sender.tab?.id }
  })

  onRuntimeMessage(RuntimeMessageType.stopAgent, async ({ data }) => {
    await stopAgentStorage.setValue({
      conversationId: data.conversationId,
      timestamp: Date.now(),
    })
  })

  // Keep whole-map selected-text mutations in one extension context and one
  // queue. The content script, panel and background cleanup can otherwise
  // race a read/modify/write and lose a newer tab selection.
  const mutateSelectedText = createSerializedMutationQueue()
  onRuntimeMessage(RuntimeMessageType.setSelectedText, ({ data, sender }) =>
    mutateSelectedText(async () => {
      if (sender.tab?.id !== data.tabId) return
      const map = await selectedTextStorage.getValue()
      await selectedTextStorage.setValue({ ...map, [data.tabId]: data })
    }),
  )
  onRuntimeMessage(RuntimeMessageType.removeSelectedText, ({ data }) =>
    mutateSelectedText(async () => {
      const map = await selectedTextStorage.getValue()
      const key = String(data.tabId)
      if (!map[key]) return
      const { [key]: _removed, ...remaining } = map
      await selectedTextStorage.setValue(remaining)
    }),
  )
  onRuntimeMessage(RuntimeMessageType.removeSelectedTextIfMatches, ({ data }) =>
    mutateSelectedText(async () => {
      const map = await selectedTextStorage.getValue()
      const key = String(data.tabId)
      const current = map[key]
      if (
        !current ||
        current.text !== data.selection.text ||
        current.pageUrl !== data.selection.url ||
        current.pageTitle !== data.selection.title ||
        current.timestamp !== data.selection.timestamp
      ) {
        return
      }
      const { [key]: _removed, ...remaining } = map
      await selectedTextStorage.setValue(remaining)
    }),
  )

  chrome.tabs.onRemoved.addListener((tabId) => {
    void conversationPanelBroker.removeTab(tabId).catch(() => undefined)
    void mutateSelectedText(async () => {
      const map = await selectedTextStorage.getValue()
      const key = String(tabId)
      if (!map[key]) return
      const { [key]: _removed, ...remaining } = map
      await selectedTextStorage.setValue(remaining)
    })
  })

  onServerMessage('checkHealth', async () => {
    try {
      const url = await getHealthCheckUrl()
      const response = await fetch(url)
      return { healthy: response.ok }
    } catch {
      return { healthy: false }
    }
  })

  onServerMessage('fetchMcpTools', async () => {
    try {
      const url = await getMcpServerUrl()
      const tools = await fetchMcpTools(url)
      return { tools }
    } catch (err) {
      return {
        tools: [],
        error: err instanceof Error ? err.message : 'Failed to fetch tools',
      }
    }
  })
})
