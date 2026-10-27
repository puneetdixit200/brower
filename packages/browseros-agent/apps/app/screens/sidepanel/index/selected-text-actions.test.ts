import { describe, expect, it } from 'bun:test'
import { getSelectedTextActionPrompt } from './selected-text-actions'

describe('selected text actions', () => {
  it('creates a concise summarize prompt', () => {
    expect(getSelectedTextActionPrompt('summarize')).toContain(
      'three concise bullet points',
    )
  })

  it('asks for the target language when translation needs clarification', () => {
    expect(getSelectedTextActionPrompt('translate')).toContain(
      'ask me which language',
    )
  })
})
