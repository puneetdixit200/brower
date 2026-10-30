import { createBrowserOSAction } from '@/lib/chat-actions/types'
import type { SearchActionStorage } from '@/lib/search-actions/searchActionsStorage'

/** Build the exact initial payload consumed as the side-panel's first user turn. */
export function buildHomeSidepanelHandoff(
  message: string,
  tabs: chrome.tabs.Tab[],
): SearchActionStorage {
  return {
    // The watcher sends this query as the model-facing user message.
    query: message,
    mode: 'chat',
    // Action.message is display/context metadata for that same turn.
    action: createBrowserOSAction({ mode: 'chat', message, tabs }),
  }
}
