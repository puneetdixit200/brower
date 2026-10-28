import type { UIMessage } from 'ai'
import {
  classifyResearchUrl,
  normalizeResearchEvidenceUrl,
  normalizeResearchSeedUrl,
  type ResearchUrlEvidence,
} from './research-request'

export interface ResearchSourceLedgerEntry {
  url: string
  displayUrl: string
  status: ResearchUrlEvidence
  observedBy: Array<'read' | 'navigate'>
  quoteChecks: Array<{ quote: string; found: boolean; sourceOffset: number }>
}

export interface ResearchSourceLedger {
  answerMessageId: string
  entries: ResearchSourceLedgerEntry[]
  /** Quotes near multiple distinct citations are never assigned by proximity. */
  unattributedQuoteCount: number
}

export const RESEARCH_LEDGER_LIMITATION =
  'URL matches confirm tool observation only. Quote checks below look for an exact string match between short answer quotes and successful built-in read text from the same URL; they do not prove claim support or truth.'

const RESEARCH_REQUEST_PREFIX =
  'Research request (Aster, explicit user initiation):'
const SEED_SECTION = 'User-attached seed sources (not automatically verified):'
const SEED_END = 'Sensitive-path filtering is heuristic'
const URL_PATTERN = /https:\/\/[^\s<>()\]"']+/gi
const MAX_ANSWER_SCAN_CHARS = 30_000
const MAX_SUCCESSFUL_TOOL_PARTS = 16
const MAX_TOOL_PARTS_SCANNED = 40
const MAX_READ_TEXT_SCAN_CHARS = 100_000
const MAX_READ_TEXT_PARTS = 8
const MAX_QUOTE_CHECKS = 12
const MAX_QUOTE_LENGTH = 240
const QUOTED_TEXT_PATTERN = /“([^”\n]{1,240})”|"([^"\n]{1,240})"/g

function textOf(
  message: UIMessage,
  maxChars = Number.POSITIVE_INFINITY,
): string {
  const parts: string[] = []
  let length = 0
  for (const part of message.parts) {
    if (part.type !== 'text') continue
    if (length >= maxChars) break
    const separator = parts.length > 0 ? '\n' : ''
    const remaining = maxChars - length - separator.length
    if (remaining <= 0) break
    const text = part.text.slice(0, remaining)
    parts.push(text)
    length += separator.length + text.length
  }
  return parts.join('\n')
}

function readText(output: unknown): string[] {
  if (!output || typeof output !== 'object') return []
  const result = output as { isError?: unknown; content?: unknown }
  if (result.isError === true || !Array.isArray(result.content)) return []
  const textParts: string[] = []
  for (const part of result.content.slice(0, MAX_READ_TEXT_PARTS)) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      textParts.push((part as { text: string }).text)
    }
  }
  return textParts
}

function quotedEvidence(
  answerText: string,
): {
  matches: Array<{ quote: string; url: string; sourceOffset: number }>
  unattributedQuoteCount: number
} {
  const text = answerText.slice(0, MAX_ANSWER_SCAN_CHARS)
  const urls = [...text.matchAll(URL_PATTERN)].map((match) => {
    const rawUrl = match[0]
    const url = rawUrl.replace(/[.,;:!?]+$/, '')
    return { url, index: match.index ?? 0 }
  })
  const quotes: Array<{ quote: string; url: string; sourceOffset: number }> = []
  let unattributedQuoteCount = 0
  let scannedQuotes = 0
  for (const match of text.matchAll(QUOTED_TEXT_PATTERN)) {
    // A maliciously long answer must not run quote × URL proximity scans
    // without an upper bound.
    if (++scannedQuotes > MAX_QUOTE_CHECKS * 2) break
    const quote = match[1] ?? match[2] ?? ''
    if (!quote.trim() || quote.length > MAX_QUOTE_LENGTH) continue
    const start = match.index ?? 0
    const end = start + match[0].length
    const nearbyCandidates = urls
      .map((candidate) => {
        const distance =
          candidate.index >= end
            ? candidate.index - end
            : start >= candidate.index + candidate.url.length
              ? start - candidate.index - candidate.url.length
              : 0
        const between = text.slice(
          Math.min(start, candidate.index),
          Math.max(end, candidate.index + candidate.url.length),
        )
        return {
          ...candidate,
          distance,
          sameParagraph: !/\n\s*\n/.test(between),
        }
      })
      .filter(
        (candidate) => candidate.distance <= 320 && candidate.sameParagraph,
      )
      .sort((left, right) => left.distance - right.distance)
    // Nearest-URL attribution is unsafe when the same paragraph cites two
    // distinct pages. Do not quietly label a quote as verified at either URL.
    const distinctUrls = new Set(
      nearbyCandidates.map((candidate) =>
        normalizeResearchEvidenceUrl(candidate.url),
      ),
    )
    if (distinctUrls.size > 1) {
      unattributedQuoteCount++
      continue
    }
    const nearby = nearbyCandidates[0]
    if (nearby) quotes.push({ quote, url: nearby.url, sourceOffset: start })
    if (quotes.length >= MAX_QUOTE_CHECKS) break
  }
  return { matches: quotes, unattributedQuoteCount }
}

function isResearchRequest(message: UIMessage): boolean {
  return (
    message.role === 'user' &&
    textOf(message).startsWith(RESEARCH_REQUEST_PREFIX)
  )
}

function getSeeds(message: UIMessage): string[] {
  const text = textOf(message)
  const start = text.indexOf(SEED_SECTION)
  if (start < 0) return []
  const remainder = text.slice(start + SEED_SECTION.length)
  const end = remainder.indexOf(SEED_END)
  const section = end < 0 ? remainder : remainder.slice(0, end)
  return extractUrls(section)
    .map(normalizeResearchSeedUrl)
    .filter((url): url is string => url !== null)
}

function extractUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? []
  return found.map((url) => url.replace(/[.,;:!?]+$/, ''))
}

function getToolName(part: UIMessage['parts'][number]): string | null {
  if (part.type === 'dynamic-tool') return part.toolName
  if (part.type.startsWith('tool-')) return part.type.slice('tool-'.length)
  return null
}

function structuredUrl(output: unknown, toolName: string): string | null {
  if (!output || typeof output !== 'object') return null
  const result = output as {
    isError?: unknown
    structuredContent?: unknown
  }
  if (
    result.isError === true ||
    !result.structuredContent ||
    typeof result.structuredContent !== 'object'
  ) {
    return null
  }
  const structured = result.structuredContent as Record<string, unknown>
  if (
    typeof structured.page !== 'number' ||
    (toolName === 'read' &&
      (!['markdown', 'text', 'links'].includes(String(structured.format)) ||
        typeof structured.contentLength !== 'number' ||
        typeof structured.writtenToFile !== 'boolean'))
  ) {
    return null
  }
  return typeof structured.url === 'string' ? structured.url : null
}

function observedToolEvidence(
  messages: UIMessage[],
): Array<{ url: string; toolName: 'read' | 'navigate'; text: string[] }> {
  const evidence: Array<{
    url: string
    toolName: 'read' | 'navigate'
    text: string[]
  }> = []
  let scannedParts = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      scannedParts += 1
      if (scannedParts > MAX_TOOL_PARTS_SCANNED) return evidence
      const toolName = getToolName(part)
      if (
        !('state' in part) ||
        part.state !== 'output-available' ||
        (toolName !== 'read' && toolName !== 'navigate')
      ) {
        continue
      }
      const url = structuredUrl(part.output, toolName)
      if (url && normalizeResearchEvidenceUrl(url)) {
        evidence.push({
          url,
          toolName,
          text: toolName === 'read' ? readText(part.output) : [],
        })
        if (evidence.length >= MAX_SUCCESSFUL_TOOL_PARTS) return evidence
      }
    }
  }
  return evidence
}

function displaySafeUrl(value: string): string {
  const safe = normalizeResearchSeedUrl(value)
  if (!safe) return 'Sensitive or unsupported URL omitted'
  return safe
}

/** Builds the latest completed research turn's citation URL checks from tool output. */
export function getResearchSourceLedger(
  messages: UIMessage[],
  isStreaming: boolean,
): ResearchSourceLedger | null {
  let requestIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isResearchRequest(messages[index])) {
      requestIndex = index
      break
    }
  }
  if (requestIndex < 0) return null

  let turnEnd = messages.length
  for (let index = requestIndex + 1; index < messages.length; index += 1) {
    if (messages[index].role === 'user') {
      turnEnd = index
      break
    }
  }
  const turn = messages.slice(requestIndex + 1, turnEnd)
  const finalAssistantIndex = turn.findLastIndex(
    (message) => message.role === 'assistant',
  )
  if (finalAssistantIndex < 0 || isStreaming) return null
  const answer = turn[finalAssistantIndex]
  const answerText = textOf(answer, MAX_ANSWER_SCAN_CHARS)
  const citations = [...new Set(extractUrls(answerText))]
  const seeds = getSeeds(messages[requestIndex])
  const candidates = [...new Set([...citations, ...seeds])]
  const observed = observedToolEvidence(turn)
  const visitedUrls = observed.map(({ url }) => url)
  let remainingReadChars = MAX_READ_TEXT_SCAN_CHARS
  const readTextByUrl = new Map<string, string[]>()
  for (const item of observed) {
    if (item.toolName !== 'read' || remainingReadChars <= 0) continue
    const normalizedUrl = normalizeResearchEvidenceUrl(item.url)
    if (!normalizedUrl) continue
    const parts: string[] = []
    for (const part of item.text) {
      if (remainingReadChars <= 0) break
      const bounded = part.slice(0, remainingReadChars)
      remainingReadChars -= bounded.length
      parts.push(bounded)
    }
    readTextByUrl.set(normalizedUrl, [
      ...(readTextByUrl.get(normalizedUrl) ?? []),
      ...parts,
    ])
  }
  const quoteEvidence = quotedEvidence(answerText)

  return {
    answerMessageId: answer.id,
    unattributedQuoteCount: quoteEvidence.unattributedQuoteCount,
    entries: candidates.map((url) => {
      const normalizedUrl = normalizeResearchEvidenceUrl(url)
      const observedBy = normalizedUrl
        ? [
            ...new Set(
              observed
                .filter(
                  (item) =>
                    normalizeResearchEvidenceUrl(item.url) === normalizedUrl,
                )
                .map(({ toolName }) => toolName),
            ),
          ]
        : []
      const quoteChecks = normalizedUrl
        ? quoteEvidence.matches
            .filter(
              (item) =>
                normalizeResearchEvidenceUrl(item.url) === normalizedUrl,
            )
            .map(({ quote, sourceOffset }) => ({
              quote,
              sourceOffset,
              found: (readTextByUrl.get(normalizedUrl) ?? []).some((text) =>
                text.includes(quote),
              ),
            }))
        : []
      return {
        url,
        displayUrl: displaySafeUrl(url),
        status: classifyResearchUrl({
          url,
          attachedSeedUrls: seeds,
          observedToolUrls: visitedUrls,
        }),
        observedBy,
        quoteChecks,
      }
    }),
  }
}
