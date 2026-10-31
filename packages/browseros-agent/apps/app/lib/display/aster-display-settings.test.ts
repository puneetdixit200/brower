import { describe, expect, it } from 'bun:test'
import {
  ASTER_DISPLAY_SETTINGS_KEY,
  DEFAULT_ASTER_DISPLAY_SETTINGS,
  installAsterDisplaySettings,
  normalizeAsterDisplaySettings,
} from './aster-display-settings'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function installStorageFixture(initialRead: Promise<Record<string, unknown>>) {
  const originalChrome = globalThis.chrome
  const originalDocument = globalThis.document
  let onChanged:
    | ((
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => void)
    | undefined
  const root = {
    style: {
      fontSize: '',
      removeProperty(property: string) {
        if (property === 'font-size') this.fontSize = ''
      },
    },
    dataset: {} as Record<string, string>,
  }
  globalThis.chrome = {
    storage: {
      local: { get: () => initialRead },
      onChanged: {
        addListener: (listener: typeof onChanged) => {
          onChanged = listener
        },
        removeListener: (listener: typeof onChanged) => {
          if (onChanged === listener) onChanged = undefined
        },
      },
    },
  } as unknown as typeof chrome
  globalThis.document = { documentElement: root } as unknown as Document
  return {
    root,
    change(settings: unknown) {
      onChanged?.(
        {
          [ASTER_DISPLAY_SETTINGS_KEY]: { newValue: settings },
        } as Record<string, chrome.storage.StorageChange>,
        'local',
      )
    },
    restore() {
      globalThis.chrome = originalChrome
      globalThis.document = originalDocument
    },
  }
}

describe('Aster display settings', () => {
  it('defaults safely on malformed storage values', () => {
    for (const value of [null, undefined, false, '', 12, {}, { scale: 1000 }]) {
      expect(normalizeAsterDisplaySettings(value)).toEqual(
        DEFAULT_ASTER_DISPLAY_SETTINGS,
      )
    }
  })

  it('accepts only deliberate scale and low-motion choices', () => {
    expect(
      normalizeAsterDisplaySettings({
        scale: 90,
        reducedMotion: true,
      }),
    ).toEqual({ scale: 90, reducedMotion: true })
    expect(
      normalizeAsterDisplaySettings({
        scale: 110,
        reducedMotion: 'true',
      }),
    ).toEqual({ scale: 110, reducedMotion: false })
  })

  it('does not let a stale initial read overwrite a newer storage change', async () => {
    const initialRead = deferred<Record<string, unknown>>()
    const fixture = installStorageFixture(initialRead.promise)
    const cleanup = installAsterDisplaySettings()
    try {
      fixture.change({ scale: 110, reducedMotion: true })
      expect(fixture.root.style.fontSize).toBe('110%')
      expect(fixture.root.dataset.asterReducedMotion).toBe('true')

      initialRead.resolve({
        [ASTER_DISPLAY_SETTINGS_KEY]: { scale: 90, reducedMotion: false },
      })
      await initialRead.promise
      await Promise.resolve()

      expect(fixture.root.style.fontSize).toBe('110%')
      expect(fixture.root.dataset.asterReducedMotion).toBe('true')
    } finally {
      cleanup()
      fixture.restore()
    }
  })
})
