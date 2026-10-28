import type { FC } from 'react'
import { cn } from '@/lib/utils'
import { SidebarBranding } from './SidebarBranding'
import { SidebarNavigation } from './SidebarNavigation'
import { SidebarUserFooter } from './SidebarUserFooter'

export interface AppSidebarProps {
  expanded?: boolean
  expandedWidth?: number
  onOpenShortcuts?: () => void
  onNavigate?: () => void
}

export const AppSidebar: FC<AppSidebarProps> = ({
  expanded = false,
  expandedWidth = 256,
  onOpenShortcuts,
  onNavigate,
}) => {
  return (
    <div
      className={cn(
        'flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out',
        expanded ? 'shrink-0' : 'w-14 shrink-0',
      )}
      style={expanded ? { width: expandedWidth } : undefined}
    >
      <SidebarBranding expanded={expanded} />
      <SidebarNavigation expanded={expanded} onNavigate={onNavigate} />
      <SidebarUserFooter
        expanded={expanded}
        onOpenShortcuts={onOpenShortcuts}
      />
    </div>
  )
}
