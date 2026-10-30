import { describe, expect, it } from 'bun:test'
import { shouldCollapseSidebarAfterResize } from './sidebar-resize'

const bounds = { left: 0, right: 320, top: 0, bottom: 800 }

describe('sidebar resize completion', () => {
  it('collapses after a drag ends outside the resized rail', () => {
    expect(
      shouldCollapseSidebarAfterResize(bounds, { x: 400, y: 200 }, false, 320),
    ).toBe(true)
  })

  it('keeps the rail expanded when the pointer or keyboard focus remains inside', () => {
    expect(
      shouldCollapseSidebarAfterResize(bounds, { x: 319, y: 799 }, false, 320),
    ).toBe(false)
    expect(
      shouldCollapseSidebarAfterResize(bounds, { x: 400, y: 200 }, true, 320),
    ).toBe(false)
  })

  it('collapses when the rail is unavailable at completion', () => {
    expect(
      shouldCollapseSidebarAfterResize(
        undefined,
        { x: 400, y: 200 },
        false,
        320,
      ),
    ).toBe(true)
  })

  it('uses the final width when pointerup is the last resize update', () => {
    const staleBounds = { left: 0, right: 256, top: 0, bottom: 800 }
    expect(
      shouldCollapseSidebarAfterResize(
        staleBounds,
        { x: 280, y: 200 },
        false,
        300,
      ),
    ).toBe(false)
  })
})
