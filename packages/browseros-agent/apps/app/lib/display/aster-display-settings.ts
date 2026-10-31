export const ASTER_DISPLAY_SETTINGS_KEY = 'aster.display.settings.v1'

export type AsterDisplayScale = 90 | 100 | 110

export interface AsterDisplaySettings {
  scale: AsterDisplayScale
  reducedMotion: boolean
}

export const DEFAULT_ASTER_DISPLAY_SETTINGS: AsterDisplaySettings = {
  scale: 100,
  reducedMotion: false,
}

export function normalizeAsterDisplaySettings(
  value: unknown,
): AsterDisplaySettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_ASTER_DISPLAY_SETTINGS }
  }
  const candidate = value as Record<string, unknown>
  return {
    scale:
      candidate.scale === 90 ||
      candidate.scale === 100 ||
      candidate.scale === 110
        ? candidate.scale
        : 100,
    reducedMotion: candidate.reducedMotion === true,
  }
}

export function applyAsterDisplaySettings(
  settings: AsterDisplaySettings,
  root: HTMLElement = document.documentElement,
): void {
  root.style.fontSize = `${settings.scale}%`
  if (settings.reducedMotion) root.dataset.asterReducedMotion = 'true'
  else delete root.dataset.asterReducedMotion
}

export async function readAsterDisplaySettings(): Promise<AsterDisplaySettings> {
  try {
    const stored = await chrome.storage.local.get(ASTER_DISPLAY_SETTINGS_KEY)
    return normalizeAsterDisplaySettings(stored[ASTER_DISPLAY_SETTINGS_KEY])
  } catch {
    return { ...DEFAULT_ASTER_DISPLAY_SETTINGS }
  }
}

export async function saveAsterDisplaySettings(
  settings: AsterDisplaySettings,
): Promise<void> {
  const normalized = normalizeAsterDisplaySettings(settings)
  await chrome.storage.local.set({ [ASTER_DISPLAY_SETTINGS_KEY]: normalized })
}

/**
 * Safe for one initial invocation in the Aster app document. Returns cleanup
 * for test fixtures; never changes Chromium page zoom or host OS settings.
 */
export function installAsterDisplaySettings(): () => void {
  let current = true
  let changeVersion = 0
  const apply = (settings: AsterDisplaySettings) => {
    if (current) applyAsterDisplaySettings(settings)
  }
  const onChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return
    const entry = changes[ASTER_DISPLAY_SETTINGS_KEY]
    if (entry) {
      changeVersion += 1
      apply(normalizeAsterDisplaySettings(entry.newValue))
    }
  }
  chrome.storage.onChanged.addListener(onChange)
  const initialChangeVersion = changeVersion
  void readAsterDisplaySettings().then((settings) => {
    if (changeVersion === initialChangeVersion) apply(settings)
  })
  return () => {
    current = false
    chrome.storage.onChanged.removeListener(onChange)
    document.documentElement.style.removeProperty('font-size')
    delete document.documentElement.dataset.asterReducedMotion
  }
}
