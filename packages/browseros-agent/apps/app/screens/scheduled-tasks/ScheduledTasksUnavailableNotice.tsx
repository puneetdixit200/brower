import type { FC } from 'react'
import { Button } from '@/components/ui/button'

export interface ScheduledTasksUnavailableNoticeProps {
  onRetry: () => void
  retrying: boolean
}

export const ScheduledTasksUnavailableNotice: FC<
  ScheduledTasksUnavailableNoticeProps
> = ({ onRetry, retrying }) => (
  <div
    role="alert"
    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
  >
    <p className="text-foreground text-sm">
      Couldn’t load scheduled tasks or their run history. Your saved tasks have
      not been changed.
    </p>
    <Button onClick={onRetry} disabled={retrying} variant="outline" size="sm">
      {retrying ? 'Retrying…' : 'Retry'}
    </Button>
  </div>
)
