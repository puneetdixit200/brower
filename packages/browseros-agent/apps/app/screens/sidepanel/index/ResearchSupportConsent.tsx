import type { FC } from 'react'

export const RESEARCH_SUPPORT_DISCLOSURE =
  'This sends the final answer and bounded excerpts from successful built-in reads to the same selected provider and model in a second AI request. It may use provider limits or incur cost. Assessment failures do not affect the research answer.'

export const ResearchSupportConsent: FC<{
  checked: boolean
  onChange: (checked: boolean) => void
}> = ({ checked, onChange }) => (
  <label className="mt-2 flex items-start gap-2 text-xs">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
    <span>
      Also request an AI support assessment
      <span className="block text-muted-foreground">
        {RESEARCH_SUPPORT_DISCLOSURE}
      </span>
    </span>
  </label>
)
