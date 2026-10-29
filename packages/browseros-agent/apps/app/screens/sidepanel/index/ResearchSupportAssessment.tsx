import type { FC } from 'react'

export interface ResearchSupportAssessmentData {
  status?: string
  assessments?: Array<{
    claim?: string
    support?: string
    explanation?: string
    sourceIds?: string[]
    sources?: Array<{ id?: string; url?: string; label?: string }>
  }>
}

const MAX_DISPLAYED_SOURCE_IDS = 8
const SAFE_SOURCE_ID = /^src_[A-Za-z0-9_-]{1,80}$/

function safeSourceIds(sourceIds: string[] | undefined): string[] {
  if (!sourceIds) return []
  return [...new Set(sourceIds.filter((id) => SAFE_SOURCE_ID.test(id)))].slice(
    0,
    MAX_DISPLAYED_SOURCE_IDS,
  )
}

function safeSourceLinks(
  sources: Array<{ id?: string; url?: string; label?: string }> | undefined,
  sourceIds: string[],
): Array<{ id: string; url: string; label: string }> {
  if (!sources) return []
  const allowedIds = new Set(sourceIds)
  return sources.flatMap((source) => {
    if (
      !source.id ||
      !allowedIds.has(source.id) ||
      !SAFE_SOURCE_ID.test(source.id)
    ) {
      return []
    }
    try {
      const url = new URL(source.url ?? '')
      const hostname = url.hostname.toLowerCase().replace(/\.+$/, '')
      const hasUnsafePath = url.pathname
        .split('/')
        .filter(Boolean)
        .some((segment) => {
          let decoded = segment
          try {
            decoded = decodeURIComponent(segment)
          } catch {
            return true
          }
          return (
            /(?:token|secret|password|session|auth|credential|api[-_]?key|private)/i.test(
              decoded,
            ) || decoded.length >= 32
          )
        })
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !hostname.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|lan)$/i.test(hostname) ||
        hostname.endsWith('.home.arpa') ||
        /^\[[0-9a-f:]+\]$/i.test(hostname) ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
        hasUnsafePath
      ) {
        return []
      }
      url.hostname = hostname
      return [{ id: source.id, url: url.toString(), label: url.hostname }]
    } catch {
      return []
    }
  })
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
        {data.assessments.slice(0, 8).map((item) => {
          const sourceIds = safeSourceIds(item.sourceIds)
          const sources = safeSourceLinks(item.sources, sourceIds)
          return (
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
              {item.claim && (
                <p className="mt-0.5">{item.claim.slice(0, 500)}</p>
              )}
              {item.explanation && (
                <p className="mt-0.5 text-muted-foreground">
                  {item.explanation.slice(0, 600)}
                </p>
              )}
              {sourceIds.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  {sources.length > 0
                    ? sources.map((source) => (
                        <a
                          className="mr-2 inline-block underline"
                          href={source.url}
                          key={source.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Source: {source.label}
                        </a>
                      ))
                    : sourceIds.map((sourceId) => (
                        <span className="mr-2 inline-block" key={sourceId}>
                          Supplied excerpt <code>{sourceId}</code>
                        </span>
                      ))}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    ) : (
      <p className="mt-1 text-muted-foreground">
        No claim-level assessment was returned. This does not establish whether
        claims are accurate.
      </p>
    )}
    <p className="mt-2 text-muted-foreground">
      This is an AI assessment of the supplied excerpts; it does not establish
      claim accuracy. Source links point to captured page addresses and do not
      establish that a claim is accurate.
    </p>
  </aside>
)
