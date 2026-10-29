import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'

const MAX_SELECTED_TEXT_LENGTH = 5000

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  async main() {
    const response = await sendRuntimeMessage(RuntimeMessageType.getTabId)
    const tabId: number | undefined = response?.tabId
    if (!tabId) return

    document.addEventListener('mouseup', () => {
      const text = window.getSelection()?.toString().trim()

      if (text && text.length > 0) {
        void sendRuntimeMessage(RuntimeMessageType.setSelectedText, {
          text: text.slice(0, MAX_SELECTED_TEXT_LENGTH),
          pageUrl: window.location.href,
          pageTitle: document.title,
          tabId,
          timestamp: Date.now(),
        })
      } else {
        void sendRuntimeMessage(RuntimeMessageType.removeSelectedText, {
          tabId,
        })
      }
    })
  },
})
