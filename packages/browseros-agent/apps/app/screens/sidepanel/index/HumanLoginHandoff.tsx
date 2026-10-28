import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  sendHumanLoginContinuation,
  startHumanLoginHandoff,
} from './human-login-handoff'

export function HumanLoginHandoffNotice({
  warning,
  continuationStatus,
  onContinue,
  onClose,
}: {
  warning: string | null
  continuationStatus: 'sending' | 'accepted' | 'rejected' | null
  onContinue: () => void
  onClose: () => void
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium">Agent stopped. Your turn.</p>
      <p>
        Sign in, confirm the passkey, or enter the one-time code directly on the
        website. Use Chromium’s password manager, not the AI prompt. This run is
        stopped and will not resume or automatically replay its last action.
        When you finish, a fresh turn will ask the agent to inspect the current
        page and avoid repeating that action. This request is advisory, not
        enforced.
      </p>
      {warning && <p role="alert">{warning}</p>}
      <Button
        size="sm"
        variant="outline"
        disabled={
          continuationStatus === 'sending' || continuationStatus === 'accepted'
        }
        onClick={onContinue}
      >
        {continuationStatus === 'sending'
          ? 'Sending continuation…'
          : 'Continue after I’m done'}
      </Button>
      {continuationStatus === 'accepted' && (
        <p role="status">
          Fresh continuation sent or queued. The stopped run was not resumed.
        </p>
      )}
      {continuationStatus === 'rejected' && (
        <p role="alert">
          The continuation was not sent. Your stopped run remains stopped. Make
          sure the verified page is active and chat is ready, then retry.
        </p>
      )}
      <Button size="sm" variant="outline" onClick={onClose}>
        Close notice
      </Button>
    </div>
  )
}

/**
 * Human-only login/MFA handoff. No password or code flows through the agent.
 * The user explicitly stops the active run, then completes browser-native
 * login in a tab they own. Continuing never replays a previous tool call.
 */
export function HumanLoginHandoff({
  onStop,
  onContinue,
  attachedTabs,
}: {
  onStop: () => void
  onContinue: (prompt: string) => boolean | Promise<boolean>
  attachedTabs: readonly chrome.tabs.Tab[]
}) {
  const [handoff, setHandoff] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [continuationStatus, setContinuationStatus] = useState<
    'sending' | 'accepted' | 'rejected' | null
  >(null)

  const begin = async () => {
    const activation = startHumanLoginHandoff(onStop, attachedTabs, chrome.tabs)
    setHandoff(true)
    setWarning(null)
    setContinuationStatus(null)
    try {
      const openedAttachedTab = await activation
      if (!openedAttachedTab) {
        setWarning(
          'No attached login tab is available in this window. Switch to the login tab manually. No credentials were accessed.',
        )
      }
    } catch {
      setWarning(
        'Could not open the attached login tab. Switch to it manually. No credentials were accessed.',
      )
    }
  }

  const continueAfterLogin = () => {
    setContinuationStatus('sending')
    void sendHumanLoginContinuation(onContinue).then(setContinuationStatus)
  }

  return (
    <aside
      aria-label="Human login and verification"
      className="rounded-md border border-border/60 px-3 py-2 text-xs"
    >
      {handoff ? (
        <HumanLoginHandoffNotice
          warning={warning}
          continuationStatus={continuationStatus}
          onContinue={continueAfterLogin}
          onClose={() => setHandoff(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Login, passkeys and CAPTCHA require your direct control.</span>
          <Button size="sm" variant="outline" onClick={() => void begin()}>
            Take over login
          </Button>
        </div>
      )}
    </aside>
  )
}
