import type { FC, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { canShowProviderSetup } from './privacy-walkthrough'

export const PRIVACY_CHECKPOINTS = [
  {
    title: 'Choose where AI runs',
    body: (
      <>
        Your prompts go to the provider or coding-agent runtime you choose.
        Cloud providers process requests on their services. Ollama and LM Studio
        can process requests locally when you configure a local endpoint.
      </>
    ),
  },
  {
    title: 'Review the context you share',
    body: (
      <>
        When a task uses browser context, page text, selected text, screenshots,
        or other attached content may be sent to your chosen provider. Review
        what a task needs before you start it.
      </>
    ),
  },
  {
    title: 'Chromium controls browser permissions',
    body: (
      <>
        Browser capabilities are subject to Chromium permissions and prompts.
        This walkthrough explains those controls; it does not grant browser
        permissions.
      </>
    ),
  },
  {
    title: 'Keep login secrets in the native flow',
    body: (
      <>
        Enter passwords, passkeys, and one-time codes through Chromium’s native
        login flow, not in an AI prompt. This setup does not import data, set
        profile paths, or complete native onboarding.
      </>
    ),
  },
  {
    title: 'Import and profile location are optional choices',
    body: (
      <>
        If you want, Chromium can open its import page so you can choose whether
        to bring browser data into this profile. Aster’s native setup owns the
        profile location; this extension cannot set or change its path.
      </>
    ),
  },
]

interface OnboardingPrivacyGateProps {
  acknowledgedSteps: number
  onAcknowledge: () => void
  onImportData: () => void
  providerSetup: ReactNode
}

/** Shows provider actions only after each sequential privacy checkpoint. */
export const OnboardingPrivacyGate: FC<OnboardingPrivacyGateProps> = ({
  acknowledgedSteps,
  onAcknowledge,
  onImportData,
  providerSetup,
}) => {
  if (canShowProviderSetup(acknowledgedSteps, PRIVACY_CHECKPOINTS.length)) {
    return (
      <section aria-labelledby="provider-setup-heading">
        <h2
          className="mb-4 font-semibold text-foreground text-xl"
          id="provider-setup-heading"
        >
          Connect a provider or coding agent
        </h2>
        {providerSetup}
        <div className="mt-8 rounded-lg border border-border p-4">
          <h3 className="font-medium text-foreground">
            Import browser data (optional)
          </h3>
          <p className="mt-1 mb-3 text-muted-foreground text-sm">
            Chromium will let you choose what to import. Nothing is imported
            until you make that choice.
          </p>
          <p className="mb-3 text-muted-foreground text-sm">
            Aster’s native setup owns the profile location; this extension
            cannot set or change its path.
          </p>
          <Button onClick={onImportData} type="button" variant="outline">
            Open Chromium import settings
          </Button>
        </div>
      </section>
    )
  }

  const checkpointIndex = Math.min(
    Math.max(acknowledgedSteps, 0),
    PRIVACY_CHECKPOINTS.length - 1,
  )
  const checkpoint = PRIVACY_CHECKPOINTS[checkpointIndex]

  return (
    <section
      aria-labelledby="privacy-walkthrough-heading"
      className="rounded-xl border border-border bg-muted/30 p-5"
    >
      <h2
        className="mb-4 font-semibold text-foreground text-xl"
        id="privacy-walkthrough-heading"
      >
        Before you connect an AI provider
      </h2>
      <p
        aria-live="polite"
        className="mb-3 text-muted-foreground text-sm"
        role="status"
      >
        Checkpoint {checkpointIndex + 1} of {PRIVACY_CHECKPOINTS.length}
      </p>
      <div aria-current="step" aria-live="polite">
        <h3 className="mb-2 font-medium text-foreground">{checkpoint.title}</h3>
        <p className="mb-6 text-muted-foreground text-sm leading-relaxed">
          {checkpoint.body}
        </p>
      </div>
      <button
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={onAcknowledge}
        type="button"
      >
        {checkpointIndex + 1 === PRIVACY_CHECKPOINTS.length
          ? 'I understand — continue to provider setup'
          : 'I understand — next'}
      </button>
    </section>
  )
}
