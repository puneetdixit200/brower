/** Chromium's native import page; the user chooses what to import there. */
export const BROWSER_DATA_IMPORT_URL = 'chrome://settings/importData'

export function openBrowserDataImport(
  createTab: (options: { url: string }) => unknown,
): void {
  createTab({ url: BROWSER_DATA_IMPORT_URL })
}
