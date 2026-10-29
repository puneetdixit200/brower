import type { FC } from 'react'

export interface ResearchSupportAssessmentData {
  status?: string
  assessments?: Array<{
    claim?: string
    support?: string
    explanation?: string
  }>
}

export const ResearchSupportAssessment: FC<{
  data: ResearchSupportAssessmentData
}> = ({ data }) => (
  <aside
    aria-label="AI support assessment"
    className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs"
  >
    <h3 className="font-medium">AI support assessment</h3>
    {data.status !== 'completed' ? (
      <p className="mt-1 text-muted-foreground">
        Assessment unavailable. The research answer is unchanged.
      </p>
    ) : data.assessments?.length ? (
      <ul className="mt-2 space-y-2">
        {data.assessments.slice(0, 8).map((item) => (
          <li key={`${item.support}:${item.claim}:${item.explanation}`}>
            <span className="font-medium">
              {item.support === 'supported'
                ? 'Excerpt appears to support'
                : item.support === 'mixed'
                  ? 'Mixed support'
                  : item.support === 'unsupported'
                    ? 'No support found in supplied excerpts'
                    : 'Unclear from supplied excerpts'}
            </span>
            {item.claim && <p className="mt-0.5">{item.claim.slice(0, 500)}</p>}
            {item.explanation && (
              <p className="mt-0.5 text-muted-foreground">
                {item.explanation.slice(0, 600)}
              </p>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-1 text-muted-foreground">
        No claim-level assessment was returned. This does not establish whether
        claims are accurate.
      </p>
    )}
    <p className="mt-2 text-muted-foreground">
      This is an AI assessment of the supplied excerpts; it does not establish
      claim accuracy.
    </p>
  </aside>
)
