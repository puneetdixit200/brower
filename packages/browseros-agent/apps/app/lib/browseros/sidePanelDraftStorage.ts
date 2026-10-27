import { storage } from '@wxt-dev/storage'
import type { SidePanelDraftMap } from './sidepanelDrafts'

export const sidePanelDraftsStorage = storage.defineItem<SidePanelDraftMap>(
  'local:sidePanelDrafts',
  { defaultValue: {} },
)
