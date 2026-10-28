import { describe, expect, it } from 'bun:test'
import {
  classifyResearchUrl,
  normalizeResearchEvidenceUrl,
  normalizeResearchSeedUrl,
  prepareSourceResearch,
} from './research-request'

describe('research URL evidence', () => {
  it('canonicalizes evidence URLs while preserving query and removing fragments', () => {
    expect(
      normalizeResearchEvidenceUrl(
        ' HTTPS://Example.COM:443/a/../guide?page=1#part ',
      ),
    ).toBe('https://example.com/guide?page=1')
  })

  it('strips query and fragment data from attached seeds', () => {
    expect(
      normalizeResearchSeedUrl(
        'https://example.com/guide?page=1&token=secret#part',
      ),
    ).toBe('https://example.com/guide')
  })

  it('drops sensitive or opaque path segments but preserves ordinary article paths', () => {
    expect(
      normalizeResearchSeedUrl('https://example.com/reset/SECRET_TOKEN'),
    ).toBe('https://example.com/')
    expect(
      normalizeResearchSeedUrl(
        'https://example.com/files/0123456789abcdef0123456789abcdef',
      ),
    ).toBe('https://example.com/')
    expect(
      normalizeResearchSeedUrl(
        'https://example.com/articles/browser-features?ref=private#intro',
      ),
    ).toBe('https://example.com/articles/browser-features')
  })

  it('rejects non-HTTPS, credential-bearing, and malformed URLs', () => {
    expect(normalizeResearchEvidenceUrl('http://example.com/page')).toBeNull()
    expect(
      normalizeResearchEvidenceUrl('https://user:secret@example.com/page'),
    ).toBeNull()
    expect(normalizeResearchEvidenceUrl('not a URL')).toBeNull()
  })

  it('marks only an exact canonical match in returned tool evidence as visited', () => {
    const base = {
      attachedSeedUrls: ['https://example.com/guide?campaign=private'],
      observedToolUrls: ['https://example.com/guide#section'],
    }

    expect(
      classifyResearchUrl({ url: 'https://example.com/guide', ...base }),
    ).toBe('visited')
    expect(
      classifyResearchUrl({
        url: 'https://example.com/other',
        ...base,
        observedToolUrls: [],
      }),
    ).toBe('unverified')
  })

  it('keeps an exact attached seed seed-only when no returned tool evidence matches', () => {
    expect(
      classifyResearchUrl({
        url: 'https://example.com/guide#section',
        attachedSeedUrls: ['https://example.com/guide'],
        observedToolUrls: [],
      }),
    ).toBe('seed-only')
  })

  it('does not equate materially different query URLs as visited or seed evidence', () => {
    expect(
      classifyResearchUrl({
        url: 'https://example.com/page?page=1',
        attachedSeedUrls: ['https://example.com/page?page=2'],
        observedToolUrls: ['https://example.com/page?page=2'],
      }),
    ).toBe('unverified')
  })
})

describe('prepareSourceResearch', () => {
  it('adds the explicit evidence contract and safe attached seed URLs', () => {
    const request = prepareSourceResearch({
      question: 'Compare these pages',
      mode: 'agent',
      tabs: [
        { url: 'https://example.com/research?token=secret#top' },
        { url: 'https://example.com/reset/SECRET_TOKEN' },
        { url: 'https://example.com/articles/browser-features' },
        { url: 'http://insecure.example/page' },
      ] as chrome.tabs.Tab[],
    })

    expect(request).toContain(
      'User-attached seed sources (not automatically verified)',
    )
    expect(request).toContain('https://example.com/research')
    expect(request).toContain('https://example.com/articles/browser-features')
    expect(request).not.toContain('token=secret')
    expect(request).not.toContain('SECRET_TOKEN')
    expect(request).toContain('Sensitive-path filtering is heuristic')
    expect(request).toContain(
      'Aster does not currently provide this prompt builder',
    )
    expect(request).toContain('Do not present URL matching as proof')
    expect(request).toContain('one short')
    expect(request).toContain('verbatim quote in double quotation marks')
    expect(request).toContain('under 240 characters')
    expect(request).toContain(
      'This quote request enables exact-text presence checking only',
    )
  })

  it('does not create a research request outside agent mode or for blank questions', () => {
    const tabs = [] as chrome.tabs.Tab[]
    expect(
      prepareSourceResearch({ question: 'question', tabs, mode: 'chat' }),
    ).toBeNull()
    expect(
      prepareSourceResearch({ question: '   ', tabs, mode: 'agent' }),
    ).toBeNull()
  })
})
