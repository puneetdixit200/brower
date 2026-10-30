const CHROMIUM_SITE_DETAILS_URL = 'chrome://settings/content/siteDetails'

type WebsitePermissionsTab = { id?: number; url?: string }

type WebsitePermissionsTabs = {
  create(properties: { url: string }): Promise<unknown>
  query(queryInfo: { currentWindow: true }): Promise<WebsitePermissionsTab[]>
}

export async function openWebsitePermissions(
  tabs: WebsitePermissionsTabs,
  selectedTabId: number | null,
): Promise<void> {
  if (selectedTabId === null) throw new Error('Select a website first')

  const currentTabs = await tabs.query({ currentWindow: true })
  const target = currentTabs.find((tab) => tab.id === selectedTabId)
  if (!target?.url) throw new Error('Website tab moved or closed')

  let siteOrigin: string
  try {
    const url = new URL(target.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported website URL')
    }
    siteOrigin = url.origin
  } catch {
    throw new Error('Website permissions are only available for web pages')
  }

  await tabs.create({
    url: `${CHROMIUM_SITE_DETAILS_URL}?site=${encodeURIComponent(siteOrigin)}`,
  })
}
