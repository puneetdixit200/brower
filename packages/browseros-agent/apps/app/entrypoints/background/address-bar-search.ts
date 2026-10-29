import { resolveHomeSearchUrl } from '@/screens/agent-command/home-search'

type OmniboxApi = {
  onInputEntered: {
    addListener(
      listener: (
        text: string,
        disposition: 'currentTab' | 'newForegroundTab' | 'newBackgroundTab',
      ) => void,
    ): void
  }
}

type TabsApi = {
  create(properties: { url: string; active: boolean }): Promise<unknown>
  update(properties: { url: string }): Promise<unknown>
}

/** Register the explicit-Enter path for the Aster omnibox keyword. */
export function registerAddressBarSearchListener(
  omnibox: OmniboxApi,
  tabs: TabsApi,
): void {
  omnibox.onInputEntered.addListener((text, disposition) => {
    const url = resolveHomeSearchUrl(text)
    if (!url) return
    const action =
      disposition === 'currentTab'
        ? tabs.update({ url })
        : tabs.create({ url, active: disposition === 'newForegroundTab' })
    void action.catch(() => undefined)
  })
}
