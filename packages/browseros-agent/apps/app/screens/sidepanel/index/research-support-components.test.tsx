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
            },
          ],
        }}
      />,
    )
    expect(completed).toContain('AI support assessment')
    expect(completed).toContain('Excerpt appears to support')
    expect(completed).toContain('does not establish claim accuracy')
    expect(completed).not.toContain('verified')
    expect(completed).not.toContain('is true')

    const failed = renderToStaticMarkup(
      <ResearchSupportAssessment data={{ status: 'unavailable' }} />,
    )
    expect(failed).toContain('Assessment unavailable')
    expect(failed).toContain('research answer is unchanged')
  })
})
