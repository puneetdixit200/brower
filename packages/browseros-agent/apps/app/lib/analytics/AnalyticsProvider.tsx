import type { FC, PropsWithChildren } from 'react'

/** PostHog autocapture, pageviews, and session recording are disabled. */
export const AnalyticsProvider: FC<PropsWithChildren> = ({ children }) =>
  children
