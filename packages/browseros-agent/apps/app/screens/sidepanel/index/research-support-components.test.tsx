import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchSupportAssessment } from './ResearchSupportAssessment'
import { ResearchSupportConsent } from './ResearchSupportConsent'

describe('research support UI', () => {
  it('discloses the second same-provider request, evidence sent, and possible cost', () => {
    const html = renderToStaticMarkup(
      <ResearchSupportConsent checked={false} onChange={() => {}} />,
    )
    expect(html).toContain('Also request an AI support assessment')
    expect(html).toContain('final answer and bounded excerpts')
    expect(html).toContain('same selected provider and model')
    expect(html).toContain('second AI request')
    expect(html).toContain('incur cost')
    expect(html).toContain(
      'Assessment failures do not affect the research answer',
    )
    expect(html).not.toContain(' checked=""')
  })

  it('renders cautious support language and a nonfatal unavailable status', () => {
    const completed = renderToStaticMarkup(
      <ResearchSupportAssessment
        data={{
          status: 'completed',
          assessments: [
            {
              claim: 'Claim A',
              support: 'supported',
              explanation: 'An excerpt appears relevant.',
              sourceIds: ['src_abc123'],
            },
          ],
        }}
      />,
    )
    expect(completed).toContain('AI support assessment')
    expect(completed).toContain('Excerpt appears to support')
    expect(completed).toContain('Supplied excerpt <code>src_abc123</code>')
    expect(completed).toContain('does not establish claim accuracy')
    expect(completed).not.toContain('verified')
    expect(completed).not.toContain('is true')

    const failed = renderToStaticMarkup(
      <ResearchSupportAssessment data={{ status: 'unavailable' }} />,
    )
    expect(failed).toContain('Assessment unavailable')
    expect(failed).toContain('research answer is unchanged')
  })

  it('shows only a bounded set of safe excerpt references', () => {
    const html = renderToStaticMarkup(
      <ResearchSupportAssessment
        data={{
          status: 'completed',
          assessments: [
            {
              claim: 'Claim B',
              support: 'mixed',
              sourceIds: [
                ...Array.from({ length: 9 }, (_, index) => `src_test_${index}`),
                'https://private.example/page',
                `src_${'x'.repeat(81)}`,
                'src_test_0',
              ],
            },
          ],
        }}
      />,
    )

    expect(html.match(/<code>/g)).toHaveLength(8)
    expect(html).toContain('Supplied excerpt <code>src_test_0</code>')
    expect(html).not.toContain('https://private.example/page')
    expect(html).not.toContain(`src_${'x'.repeat(81)}`)
  })

  it('renders only safe HTTPS source links attached to referenced IDs', () => {
    const html = renderToStaticMarkup(
      <ResearchSupportAssessment
        data={{
          status: 'completed',
          assessments: [
            {
              claim: 'Claim with sources',
              support: 'supported',
              sourceIds: ['src_safe', 'src_opaque', 'https://bad.test'],
              sources: [
                {
                  id: 'src_safe',
                  url: 'https://news.example.test/story',
                  label: 'ignored label',
                },
                {
                  id: 'src_unreferenced',
                  url: 'https://unreferenced.example.test/page',
                },
                {
                  id: 'src_opaque',
                  url: 'https://public.example.test/session/opaque-token',
                },
                {
                  id: 'src_safe',
                  url: 'http://unsafe.example.test/page',
                },
                {
                  id: 'src_safe',
                  url: 'https://user:pass@unsafe.example.test/page',
                },
              ],
            },
          ],
        }}
      />,
    )
    expect(html).toContain(
      '<a class="mr-2 inline-block underline" href="https://news.example.test/story" rel="noreferrer" target="_blank">Source: news.example.test</a>',
    )
    expect(html).not.toContain('unreferenced.example.test')
    expect(html).not.toContain('unsafe.example.test')
    expect(html).not.toContain('public.example.test')
    expect(html).toContain('does not establish')
  })

  it('suppresses trailing-dot localhost and local-use source links', () => {
    const localSources = [
      { id: 'src_localhost', url: 'https://localhost./admin' },
      { id: 'src_lan', url: 'https://router.lan/page' },
      { id: 'src_home', url: 'https://printer.home.arpa/page' },
    ]
    const html = renderToStaticMarkup(
      <ResearchSupportAssessment
        data={{
          status: 'completed',
          assessments: [
            {
              claim: 'Local address claim',
              support: 'unclear',
              sourceIds: localSources.map((source) => source.id),
              sources: localSources,
            },
          ],
        }}
      />,
    )
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href="https://localhost.')
    expect(html).not.toContain('router.lan')
    expect(html).not.toContain('printer.home.arpa')
  })
})
