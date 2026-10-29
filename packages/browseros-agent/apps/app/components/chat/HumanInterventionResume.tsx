import { useState } from 'react'
import type { HumanInterventionWait } from '@/modules/chat/human-intervention-client'

interface HumanInterventionResumeProps {
  wait: HumanInterventionWait | null
  onResume: () => Promise<boolean>
  onStartFresh?: () => Promise<boolean>
}

export function HumanInterventionResume({
  wait,
  onResume,
  onStartFresh,
}: HumanInterventionResumeProps) {
  const [isResuming, setIsResuming] = useState(false)
  const [resumeFailed, setResumeFailed] = useState(false)
  const [isStartingFresh, setIsStartingFresh] = useState(false)
  const [freshStartFailed, setFreshStartFailed] = useState(false)
  if (!wait) return null

  const handleResume = async () => {
    setIsResuming(true)
    setResumeFailed(false)
    try {
      setResumeFailed(!(await onResume()))
    } finally {
      setIsResuming(false)
    }
  }

  const handleStartFresh = async () => {
    if (!onStartFresh) return
    setIsStartingFresh(true)
    setFreshStartFailed(false)
    try {
      setFreshStartFailed(!(await onStartFresh()))
    } catch {
      setFreshStartFailed(true)
    } finally {
      setIsStartingFresh(false)
    }
  }

  if (wait.phase === 'interrupted') {
    return (
      <section
        className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
        aria-label="The previous run was interrupted"
        aria-live="polite"
      >
        <div>
          <p className="font-medium">The previous run was interrupted.</p>
          <p className="text-muted-foreground text-xs">
            Start an empty chat to enter a new prompt. The old run and
            transcript will not continue.
          </p>
          {freshStartFailed && (
            <p role="status" className="text-muted-foreground text-xs">
              Could not start a fresh chat. The interrupted run is unchanged.
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-60"
          onClick={() => void handleStartFresh()}
          disabled={isStartingFresh || !onStartFresh}
          aria-label="Start a fresh chat after interruption"
        >
          {isStartingFresh ? 'Starting…' : 'Start fresh chat'}
        </button>
      </section>
    )
  }

  return (
    <section
      className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm"
      aria-label="Agent is waiting for your input"
      aria-live="polite"
    >
      <div>
        <p className="font-medium">The agent is waiting for your input.</p>
        {resumeFailed && (
          <p role="status" className="text-muted-foreground text-xs">
            Could not resume yet. Try again.
          </p>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-60"
        onClick={() => void handleResume()}
        disabled={isResuming}
        aria-label="Resume the agent"
      >
        {isResuming ? 'Resuming…' : 'Resume'}
      </button>
    </section>
  )
}
