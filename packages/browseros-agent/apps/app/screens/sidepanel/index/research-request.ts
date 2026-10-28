import type { ChatMode } from '@/modules/chat/chat-types'

export function prepareSourceResearch(input: {
  question: string
  tabs: readonly chrome.tabs.Tab[]
  mode: ChatMode
}): string | null {
  if (input.mode !== 'agent' || !input.question.trim()) return null
  const sources = input.tabs.flatMap((tab) => {
    if (!tab.url) return []
    try {
      const url = new URL(tab.url)
      if (url.protocol !== 'https:' || url.username || url.password) return []
      // Never leak URL query tokens, fragments or cookies as research seeds.
      return [url.origin + url.pathname]
    } catch {
      return []
    }
  }).slice(0, 8)

  return [
    'Research request (Aster, explicit user initiation):',
    input.question.trim(),
    '',
    'Use actual browsing tools to verify claims. Prefer primary/official',
    'sources, provide original source URLs beside factual statements,',
    'separate uncertainty from evidence, and never invent citations.',
    'If browsing or access is unavailable, say so rather than claiming',
    'the research was verified. Do not submit forms or make purchases',
    'without normal user approval.',
    '',
    'User-attached seed sources (not automatically verified):',
    ...(sources.length ? sources : ['None attached; discover sources while browsing.']),
  ].join('\n')
}
