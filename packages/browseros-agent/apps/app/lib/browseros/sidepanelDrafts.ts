export interface SidePanelDraft {
  input: string
  attachedTabIds: number[]
  updatedAt: number
}

export type SidePanelDraftMap = Record<string, SidePanelDraft>

export function getSidePanelDraft(
  drafts: SidePanelDraftMap,
  tabId: number,
): SidePanelDraft | undefined {
  return drafts[String(tabId)]
}

export function setSidePanelDraft(
  drafts: SidePanelDraftMap,
  tabId: number,
  draft: SidePanelDraft,
): SidePanelDraftMap {
  return { ...drafts, [String(tabId)]: draft }
}

export function removeSidePanelDraft(
  drafts: SidePanelDraftMap,
  tabId: number,
): SidePanelDraftMap {
  const { [String(tabId)]: _removed, ...remaining } = drafts
  return remaining
}
