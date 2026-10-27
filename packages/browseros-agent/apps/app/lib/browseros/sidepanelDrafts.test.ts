import { describe, expect, it } from 'bun:test'
import {
  getSidePanelDraft,
  removeSidePanelDraft,
  setSidePanelDraft,
} from './sidepanelDrafts'

describe('side panel drafts', () => {
  it('keeps drafts separate by owning tab', () => {
    const first = {
      input: 'Summarize this page',
      attachedTabIds: [11],
      updatedAt: 100,
    }
    const second = {
      input: 'Compare these pages',
      attachedTabIds: [22, 23],
      updatedAt: 200,
    }
    const drafts = setSidePanelDraft(
      setSidePanelDraft({}, 11, first),
      22,
      second,
    )

    expect(getSidePanelDraft(drafts, 11)).toEqual(first)
    expect(getSidePanelDraft(drafts, 22)).toEqual(second)
  })

  it('removes only the draft for the closed tab', () => {
    const drafts = setSidePanelDraft(
      setSidePanelDraft({}, 11, {
        input: 'first',
        attachedTabIds: [11],
        updatedAt: 100,
      }),
      22,
      { input: 'second', attachedTabIds: [22], updatedAt: 200 },
    )

    expect(removeSidePanelDraft(drafts, 11)).toEqual({
      '22': { input: 'second', attachedTabIds: [22], updatedAt: 200 },
    })
  })
})
