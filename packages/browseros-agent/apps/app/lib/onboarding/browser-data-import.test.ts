import { describe, expect, it } from 'bun:test'
import {
  BROWSER_DATA_IMPORT_URL,
  openBrowserDataImport,
} from './browser-data-import'

describe('browser data import handoff', () => {
  it('opens Chromium import settings only through the supplied tab creator', () => {
    const createdTabs: Array<{ url: string }> = []

    openBrowserDataImport((options) => createdTabs.push(options))

    expect(BROWSER_DATA_IMPORT_URL).toBe('chrome://settings/importData')
    expect(createdTabs).toEqual([{ url: 'chrome://settings/importData' }])
  })
})
