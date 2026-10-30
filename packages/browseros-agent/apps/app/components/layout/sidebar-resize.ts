type SidebarBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>

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
