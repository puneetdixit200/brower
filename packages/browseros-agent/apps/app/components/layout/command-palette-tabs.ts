export interface CommandPaletteTab {
  id?: number
  title?: string
  url?: string
}

export interface CurrentWindowTabsApi {
  query: (queryInfo: { currentWindow: true }) => Promise<CommandPaletteTab[]>
  update: (
    tabId: number,
    updateProperties: { active: true },
  ) => Promise<unknown>
}

function isPaletteTab(
  tab: CommandPaletteTab,
): tab is CommandPaletteTab & { id: number } {
  return typeof tab.id === 'number'
}

export function filterCommandPaletteTabs(
  tabs: CommandPaletteTab[],
  query: string,
): (CommandPaletteTab & { id: number })[] {
  const term = query.trim().toLocaleLowerCase()
  return tabs.filter(isPaletteTab).filter((tab) => {
    if (!term) return true
    return `${tab.title ?? ''} ${tab.url ?? ''}`
      .toLocaleLowerCase()
      .includes(term)
  })
}

/** A cancellable, current-window-only wrapper around the tabs API. */
export class CurrentWindowTabs {
  private requestId = 0

  constructor(
    private readonly api: CurrentWindowTabsApi,
    private readonly excludedUrlPrefix?: string,
  ) {}

  cancelPendingQuery(): void {
    this.requestId += 1
  }

  async query(): Promise<CommandPaletteTab[] | undefined> {
    const requestId = ++this.requestId
    try {
      const tabs = await this.api.query({ currentWindow: true })
      if (requestId !== this.requestId) return undefined
      return tabs
        .filter(isPaletteTab)
        .filter(
          (tab) =>
            !this.excludedUrlPrefix ||
            !tab.url?.startsWith(this.excludedUrlPrefix),
        )
    } catch (error) {
      if (requestId !== this.requestId) return undefined
      throw error
    }
  }

  activate(tabId: number): Promise<unknown> {
    return this.query().then((tabs) => {
      if (!tabs?.some((tab) => tab.id === tabId)) {
        throw new Error('Tab is no longer in the current window')
      }
      return this.api.update(tabId, { active: true })
    })
  }
}
