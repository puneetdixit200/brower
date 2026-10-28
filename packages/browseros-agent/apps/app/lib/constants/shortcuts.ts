/**
 * @public
 */
export const SHORTCUTS_LIST = [
  {
    key: 'K',
    description: 'Open Aster command palette',
    modifier: {
      windows: 'Ctrl+Alt',
      mac: '⌘+Option',
      linux: 'Ctrl+Alt',
    },
  },
  {
    key: 'A',
    description: 'Toggle Agent',
    modifier: {
      windows: 'Alt',
      mac: '⌥',
      linux: 'Alt',
    },
  },
  {
    key: 'K',
    description: 'Toggle LLM Chat',
    modifier: {
      windows: 'Ctrl+Shift',
      mac: '⌘+Shift',
      linux: 'Ctrl+Shift',
    },
  },
  {
    key: 'L',
    description: 'Switch providers in LLM Chat',
    modifier: {
      windows: 'Ctrl+Shift',
      mac: '⌘+Shift',
      linux: 'Ctrl+Shift',
    },
  },
]

type CommandPaletteKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>

/** Matches Ctrl/Meta+Alt+K without consuming repeated or modified chords. */
export function isCommandPaletteShortcut(
  event: CommandPaletteKeyEvent,
  isOnboarding: boolean,
  isMac: boolean | undefined,
): boolean {
  const hasExpectedPrimaryModifier =
    isMac === true
      ? event.metaKey && !event.ctrlKey
      : isMac === false && event.ctrlKey && !event.metaKey
  return (
    !isOnboarding &&
    !event.repeat &&
    hasExpectedPrimaryModifier &&
    event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  )
}
