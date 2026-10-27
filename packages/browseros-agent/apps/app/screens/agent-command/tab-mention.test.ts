import { describe, expect, it } from 'bun:test'
import {
  findTabMention,
  removeTabMention,
  updateTabMention,
} from './tab-mention'

describe('tab mention input', () => {
  it('opens for @ at the start or after whitespace', () => {
    expect(findTabMention('@', 1)).toEqual({ startPosition: 0, filterText: '' })
    expect(findTabMention('read @', 6)).toEqual({
      startPosition: 5,
      filterText: '',
    })
  })

  it('does not treat an email address as a tab mention', () => {
    expect(findTabMention('person@example.com', 8)).toBeNull()
  })

  it('filters the current @ word and ignores text after a space', () => {
    expect(
      updateTabMention('@docs summary', 5, {
        startPosition: 0,
        filterText: '',
      }),
    ).toEqual({
      startPosition: 0,
      filterText: 'docs',
    })
  })

  it('updates an open filter and closes when its marker is removed', () => {
    const mention = { startPosition: 3, filterText: 'exa' }
    expect(updateTabMention('Hi @example', 7, mention)).toEqual({
      startPosition: 3,
      filterText: 'exa',
    })
    expect(updateTabMention('Hi example', 7, mention)).toBeNull()
    expect(updateTabMention('Hi @example', 2, mention)).toBeNull()
  })

  it('removes the marker and filter when canceled without losing surrounding text', () => {
    expect(
      removeTabMention('Compare @docs with this', {
        startPosition: 8,
        filterText: 'docs',
      }),
    ).toBe('Compare  with this')
  })
})
