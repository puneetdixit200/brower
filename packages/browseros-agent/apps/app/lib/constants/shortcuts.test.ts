import { describe, expect, it } from 'bun:test'
import { isCommandPaletteShortcut } from './shortcuts'

const event = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: 'k',
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: true,
  shiftKey: false,
  ...overrides,
})

describe('command palette shortcut', () => {
  it.each([
    ['Windows Ctrl+Alt+K', { ctrlKey: true }],
    ['Linux Ctrl+Alt+K', { ctrlKey: true }],
    ['macOS Meta+Alt+K', { metaKey: true }],
    ['uppercase K', { ctrlKey: true, key: 'K' }],
  ])('accepts %s', (platform, modifiers) => {
    const isMac = platform === 'macOS Meta+Alt+K'
    expect(isCommandPaletteShortcut(event(modifiers), false, isMac)).toBe(true)
  })

  it.each([
    ['no primary modifier', {}],
    ['both primary modifiers', { ctrlKey: true, metaKey: true }],
    ['missing Alt', { ctrlKey: true, altKey: false }],
    ['Shift held', { ctrlKey: true, shiftKey: true }],
    ['repeated keydown', { ctrlKey: true, repeat: true }],
    ['another key', { ctrlKey: true, key: 'j' }],
  ])('rejects %s', (_reason, modifiers) => {
    expect(isCommandPaletteShortcut(event(modifiers), false, false)).toBe(false)
  })

  it('rejects the shortcut during onboarding', () => {
    expect(
      isCommandPaletteShortcut(event({ ctrlKey: true }), true, false),
    ).toBe(false)
  })

  it('rejects the other platform primary modifier', () => {
    expect(
      isCommandPaletteShortcut(event({ metaKey: true }), false, false),
    ).toBe(false)
    expect(
      isCommandPaletteShortcut(event({ ctrlKey: true }), false, true),
    ).toBe(false)
  })
})
