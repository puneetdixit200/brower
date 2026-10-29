type NavigationTab = {
  id?: number
  url?: string
}

type NavigationApi = {
  query: (queryInfo: { currentWindow: true }) => Promise<NavigationTab[]>
  goBack: (tabId: number) => Promise<void>
  goForward: (tabId: number) => Promise<void>
}

type StopTabLoadingApi = {
  query: (queryInfo: { currentWindow: true }) => Promise<NavigationTab[]>
  stopTabLoading: (tabId: number) => Promise<void>
}

export async function navigateSelectedWebTab(
  api: NavigationApi,
  selectedTabId: number | null,
  direction: 'back' | 'forward',
) {
  if (selectedTabId === null) throw new Error('Select a website first')

  const tabs = await api.query({ currentWindow: true })
  const target = tabs.find(
    (tab) =>
      tab.id === selectedTabId &&
      (tab.url?.startsWith('https://') || tab.url?.startsWith('http://')),
  )
  if (target?.id === undefined) throw new Error('Website tab moved or closed')

  if (direction === 'back') await api.goBack(target.id)
  else await api.goForward(target.id)
}

export async function stopSelectedWebTabLoading(
  api: StopTabLoadingApi,
  selectedTabId: number | null,
) {
  if (selectedTabId === null) throw new Error('Select a website first')

  const tabs = await api.query({ currentWindow: true })
  const target = tabs.find(
    (tab) =>
      tab.id === selectedTabId &&
      (tab.url?.startsWith('https://') || tab.url?.startsWith('http://')),
  )
  if (target?.id === undefined) throw new Error('Website tab moved or closed')

  await api.stopTabLoading(target.id)
}
