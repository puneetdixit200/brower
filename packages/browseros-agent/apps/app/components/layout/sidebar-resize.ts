type SidebarBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 420
export const DEFAULT_SIDEBAR_WIDTH = 256

/** Keep stored, pointer, and keyboard widths within the supported range. */
export function boundedSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, Math.round(value)),
  )
}

/** Parse a saved width with the same Number() and bounds behavior as storage reads. */
export function storedSidebarWidth(value: string | null): number {
  return value === null
    ? DEFAULT_SIDEBAR_WIDTH
    : boundedSidebarWidth(Number(value))
}

/** Return the next width for a supported resize key, or null for other keys. */
export function keyboardSidebarWidth(
  width: number,
  key: string,
): number | null {
  if (key === 'Home') return MIN_SIDEBAR_WIDTH
  if (key === 'End') return MAX_SIDEBAR_WIDTH
  const delta = key === 'ArrowRight' ? 16 : key === 'ArrowLeft' ? -16 : 0
  return delta ? boundedSidebarWidth(width + delta) : null
}

/** Collapse after a drag ends outside the rail unless keyboard focus remains in it. */
export function shouldCollapseSidebarAfterResize(
  bounds: SidebarBounds | undefined,
  pointer: { x: number; y: number },
  hasFocusedDescendant: boolean,
  finalWidth: number,
): boolean {
  if (hasFocusedDescendant) return false
  if (!bounds) return true
  // React may not have committed the final width when pointerup fires.
  const finalRight = bounds.left + finalWidth
  return (
    pointer.x < bounds.left ||
    pointer.x >= finalRight ||
    pointer.y < bounds.top ||
    pointer.y >= bounds.bottom
  )
}
