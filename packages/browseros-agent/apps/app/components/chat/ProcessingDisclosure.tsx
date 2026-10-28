import { Info } from 'lucide-react'
import type { Provider } from './chatComponentTypes'

function locationFor(provider: Provider | null): {
  label: string
  explanation: string
} {
  if (!provider) {
    return {
      label: 'No model connected',
      explanation: 'Connect a model before sharing page context or sending an AI task.',
    }
  }
  if (provider.kind === 'acp') {
    return {
      label: 'External agent runtime',
      explanation:
        'The selected coding-agent process controls model routing. It may send your prompts and attached page context to a cloud service. Check that agent’s configuration.',
    }
  }
  if (provider.type === 'ollama' || provider.type === 'lmstudio') {
    return {
      label: 'Self-hosted endpoint',
      explanation:
        'This provider is local-capable, but its configured endpoint may be on another computer. Page context can be sent to that endpoint. Verify the host and model before sending.',
    }
  }
  if (provider.type === 'openai-compatible') {
    return {
      label: 'Custom provider endpoint',
      explanation:
        'The custom model endpoint receives prompts and any attached browser context. Check its configured URL and privacy terms before sending.',
    }
  }
  return {
    label: 'Cloud-backed AI provider',
    explanation:
      'The selected model service can receive your prompt and explicit attached page or tab context. Provider storage and retention policies are separate from Aster.',
  }
}

/** The location is conservative: it is never inferred from a marketing name. */
export function ProcessingDisclosure({
  provider,
  compact = false,
}: {
  provider: Provider | null
  compact?: boolean
}) {
  const location = locationFor(provider)
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-left text-muted-foreground text-xs"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <strong className="text-foreground">{location.label}</strong>
        {compact ? ': ' : ' · '}
        {location.explanation}
      </span>
    </div>
  )
}
