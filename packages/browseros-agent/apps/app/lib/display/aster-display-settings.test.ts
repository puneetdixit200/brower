import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_ASTER_DISPLAY_SETTINGS,
  normalizeAsterDisplaySettings,
} from './aster-display-settings'

describe('Aster display settings', () => {
  it('defaults safely on malformed storage values', () => {
    for (const value of [null, undefined, false, '', 12, {}, { scale: 1000 }]) {
      expect(normalizeAsterDisplaySettings(value)).toEqual(
        DEFAULT_ASTER_DISPLAY_SETTINGS,
      )
    }
  })

  it('accepts only deliberate scale and low-motion choices', () => {
    expect(normalizeAsterDisplaySettings({
      scale: 90,
      reducedMotion: true,
    })).toEqual({ scale: 90, reducedMotion: true })
    expect(normalizeAsterDisplaySettings({
      scale: 110,
      reducedMotion: 'true',
    })).toEqual({ scale: 110, reducedMotion: false })
  })
})
