import { describe, expect, it } from 'bun:test'
import {
  boundedSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  keyboardSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  shouldCollapseSidebarAfterResize,
} from './sidebar-resize'

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

describe('sidebar resize widths', () => {
  it('clamps stored and computed widths and rounds to whole pixels', () => {
    expect(boundedSidebarWidth(100)).toBe(MIN_SIDEBAR_WIDTH)
    expect(boundedSidebarWidth(500)).toBe(MAX_SIDEBAR_WIDTH)
    expect(boundedSidebarWidth(300.6)).toBe(301)
    expect(boundedSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(boundedSidebarWidth(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_SIDEBAR_WIDTH,
    )
  })

  it('supports arrows, Home, and End while ignoring other keys', () => {
    expect(keyboardSidebarWidth(256, 'ArrowRight')).toBe(272)
    expect(keyboardSidebarWidth(256, 'ArrowLeft')).toBe(240)
    expect(keyboardSidebarWidth(256, 'Home')).toBe(MIN_SIDEBAR_WIDTH)
    expect(keyboardSidebarWidth(256, 'End')).toBe(MAX_SIDEBAR_WIDTH)
    expect(keyboardSidebarWidth(256, 'Enter')).toBeNull()
  })

  it('keeps keyboard arrow changes within the width limits', () => {
    expect(keyboardSidebarWidth(MIN_SIDEBAR_WIDTH, 'ArrowLeft')).toBe(
      MIN_SIDEBAR_WIDTH,
    )
    expect(keyboardSidebarWidth(MAX_SIDEBAR_WIDTH, 'ArrowRight')).toBe(
      MAX_SIDEBAR_WIDTH,
    )
  })
})
