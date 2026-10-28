import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Human-only login/MFA handoff. No password or code flows through the agent.
 * The user explicitly stops the active run, then completes browser-native
 * login in a tab they own. Continuing never replays a previous tool call.
 */
export function HumanLoginHandoff({
  onStop,
  attachedTabs,
}: {
  onStop: () => void
  attachedTabs: readonly chrome.tabs.Tab[]
}) {
  const [handoff, setHandoff] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  const begin = async () => {
    onStop()
    setHandoff(true)
    setWarning(null)
    try {
      const currentWindow = await chrome.tabs.query({ currentWindow: true })
      const eligible = currentWindow.find(
        (tab) =>
          attachedTabs.some((attached) => attached.id === tab.id) &&
          tab.id !== undefined &&
          /^https?:\/\//i.test(tab.url ?? ''),
      )
      if (eligible?.id !== undefined) {
        await chrome.tabs.update(eligible.id, { active: true })
      }
    } catch {
      setWarning('Switch to the login tab manually. No credentials were accessed.')
    }
  }

  return (
    <aside aria-label="Human login and verification" className="rounded-md border border-border/60 px-3 py-2 text-xs">
      {handoff ? (
        <div className="space-y-2">
          <p className="font-medium">Agent stopped. Your turn.</p>
          <p>
            Sign in, confirm the passkey, or enter the one-time code directly
            on the website. Use Chromium’s password manager, not the AI prompt.
            The agent will not automatically replay its last tool call.
          </p>
          {warning && <p role="alert">{warning}</p>}
          <Button size="sm" variant="outline" onClick={() => setHandoff(false)}>
            Finished verification
          </Button>
        </div>
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
