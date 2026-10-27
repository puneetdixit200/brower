export interface TabMentionState {
  startPosition: number
  filterText: string
}

/** Finds a newly typed @ at a word boundary and its filter text. */
export function findTabMention(
  value: string,
  cursorPosition: number,
): TabMentionState | null {
  const startPosition = cursorPosition - 1
  if (startPosition < 0 || value[startPosition] !== '@') return null
  if (!/(?:^|[\s\n])$/.test(value.slice(0, startPosition))) return null
  return {
    startPosition,
    filterText: mentionFilter(value, startPosition, cursorPosition),
  }
}

/** Keeps an open tab mention in sync with edits before the caret. */
export function updateTabMention(
  value: string,
  cursorPosition: number,
  mention: TabMentionState,
): TabMentionState | null {
  if (
    cursorPosition <= mention.startPosition ||
    value[mention.startPosition] !== '@'
  ) {
    return null
  }
  return {
    startPosition: mention.startPosition,
    filterText: mentionFilter(value, mention.startPosition, cursorPosition),
  }
}

/** Removes a canceled @query while preserving text on either side. */
export function removeTabMention(
  value: string,
  mention: TabMentionState,
): string {
  const endPosition = mention.startPosition + 1 + mention.filterText.length
  return value.slice(0, mention.startPosition) + value.slice(endPosition)
}

function mentionFilter(
  value: string,
  startPosition: number,
  cursorPosition: number,
): string {
  const afterAt = value.slice(startPosition + 1, cursorPosition)
  const space = afterAt.search(/\s/)
  return space === -1 ? afterAt : afterAt.slice(0, space)
}
