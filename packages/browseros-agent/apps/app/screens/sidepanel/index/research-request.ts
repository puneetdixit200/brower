import type { ChatMode } from '@/modules/chat/chat-types'

/**
 * Canonicalize a citation/evidence URL for exact comparison. Preserve the
 * query because it can select materially different page content; discard only
 * the fragment. URL canonicalization normalizes the host, default port, and
 * dot segments while preserving path case.
 */
export function normalizeResearchEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

const sensitiveRouteMarker =
  /(?:^|[^a-z0-9])(?:reset|token|auth|oauth|session|key|password|invite|login|verify)(?:$|[^a-z0-9])/i
const uuidSegment = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const jwtSegment = /^[a-z\d_-]{8,}\.[a-z\d_-]{8,}\.[a-z\d_-]{8,}$/i
const emailSegment = /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/

function hasHighRiskPath(value: string): boolean {
  return value.split('/').some((rawSegment) => {
    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch {
      // A malformed escape cannot be safely inspected; omit the path.
      return true
    }

    if (sensitiveRouteMarker.test(segment)) return true
    if (
      uuidSegment.test(segment) ||
      jwtSegment.test(segment) ||
      emailSegment.test(segment)
    ) {
      return true
    }

    // Long URL-safe values are often lowercase hex or digits only; accept
    // false positives for long slugs to avoid leaking opaque identifiers.
    return /^[a-z\d_-]{24,}$/i.test(segment)
  })
}

/**
 * Remove query/fragment data before an attached tab URL enters the prompt.
 * Sensitive route names and recognizable opaque path values cause the path
 * to be dropped. This heuristic cannot detect every secret, so it is a
 * reduction measure rather than a guarantee that URL paths contain no secrets.
 */
export function normalizeResearchSeedUrl(value: string): string | null {
  const normalized = normalizeResearchEvidenceUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  url.search = ''
  if (hasHighRiskPath(url.pathname)) url.pathname = '/'
  return url.href
}

export type ResearchUrlEvidence = 'visited' | 'seed-only' | 'unverified'

/**
 * Classify URL evidence without treating an attached tab as a visited source.
 * `observedToolUrls` must contain URLs extracted from successful browser-tool
 * evidence by a trusted caller; arbitrary model prose is not such evidence.
 */
export function classifyResearchUrl(input: {
  url: string
  attachedSeedUrls: readonly string[]
  observedToolUrls: readonly string[]
}): ResearchUrlEvidence {
  const candidate = normalizeResearchEvidenceUrl(input.url)
  if (!candidate) return 'unverified'

  if (
    input.observedToolUrls.some(
      (url) => normalizeResearchEvidenceUrl(url) === candidate,
    )
  ) {
    return 'visited'
  }
  if (
    input.attachedSeedUrls.some(
      (url) => normalizeResearchEvidenceUrl(url) === candidate,
    )
  ) {
    return 'seed-only'
  }
  return 'unverified'
}

export function prepareSourceResearch(input: {
  question: string
  tabs: readonly chrome.tabs.Tab[]
  mode: ChatMode
}): string | null {
  if (input.mode !== 'agent' || !input.question.trim()) return null
  const sources = input.tabs
    .flatMap((tab) => {
      if (!tab.url) return []
      const url = normalizeResearchSeedUrl(tab.url)
      return url ? [url] : []
    })
    .slice(0, 8)

  return [
    'Research request (Aster, explicit user initiation):',
    input.question.trim(),
    '',
    'Use actual browsing tools to research claims. Prefer primary/official',
    'sources and provide original source URLs beside factual statements.',
    'Keep a source ledger with these exact labels: seed-only, visited,',
    'and unverified. An attached seed is seed-only until a successful',
    'browser-tool result provides evidence for that same canonical HTTPS URL.',
    'Mark a citation visited only when its canonical URL exactly matches a',
    'URL explicitly present in returned browser-tool evidence. Ignore URL',
    'fragment differences but preserve query parameters and path case when',
    'comparing URLs because they can select materially different page content.',
    'Do not infer a visited URL from a search result title, model memory,',
    'or an attached seed alone. Do not present URL matching as proof that',
    'a page supports a claim. For each factual claim, include one short',
    'verbatim quote in double quotation marks immediately beside its source',
    'URL. Keep each quote under 240 characters and preserve its exact text.',
    'This quote request enables exact-text presence checking only; it does',
    'not establish that the quote supports the claim or that either is true.',
    'Identify any claim for which page evidence is missing.',
    'Separate uncertainty from evidence and never invent citations.',
    'If browsing or access is unavailable, say so rather than claiming',
    'the research was verified. Do not submit forms or make purchases',
    'without normal user approval.',
    '',
    'User-attached seed sources (not automatically verified):',
    ...(sources.length
      ? sources
      : ['None attached; discover sources while browsing.']),
    'Sensitive-path filtering is heuristic and cannot guarantee that every',
    'secret in an attached URL has been removed.',
    '',
    'Verification limitation: this request includes attached seed URLs only.',
    'Aster does not currently provide this prompt builder a trusted structured',
    'feed of URLs observed in returned browser-tool evidence. Do not claim Aster',
    'independently verified visits or claim support; report the evidence you',
    'actually observed and label any unproven URL as unverified.',
  ].join('\n')
}
