import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { SnapshotDiff } from '@browseros/browser-core/core/snapshot/diff'
import { act } from './act'
import { executeTool } from './framework'

const DIFF: SnapshotDiff = {
  changed: true,
  text: 'DIFF_BODY_MARKER + button "Save" [ref=e1]',
  added: 3,
  removed: 1,
}

// Minimal session: act(kind=focus) only calls input().focus, and the post-action
// diff reads observe().diff() plus pages.getInfo for the origin.
function mockSession(
  diff: SnapshotDiff,
  fill?: (ref: string, value: string) => Promise<void>,
): BrowserSession {
  return {
    input: () => ({ focus: async () => {}, fill }),
    observe: () => ({ diff: async () => diff }),
    pages: { getInfo: () => ({ url: 'https://example.com/act' }) },
  } as unknown as BrowserSession
}

function textOf(result: { content?: unknown } | undefined): string {
  if (!Array.isArray(result?.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        (item as { type: unknown }).type === 'text' &&
        'text' in item &&
        typeof (item as { text: unknown }).text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

describe('act diff control (#2700)', () => {
  it('includes the full diff by default', async () => {
    const result = await executeTool(
      act,
      { page: 0, kind: 'focus', ref: 'e1' },
      { session: mockSession(DIFF) },
    )
    const text = textOf(result)
    expect(text).toContain('ok (focus)')
    expect(text).toContain('[Page 0 diff]')
    expect(text).toContain('DIFF_BODY_MARKER')
  })

  it('skips the diff entirely for diff="none"', async () => {
    const result = await executeTool(
      act,
      { page: 0, kind: 'focus', ref: 'e1', diff: 'none' },
      { session: mockSession(DIFF) },
    )
    const text = textOf(result)
    expect(text).toContain('ok (focus)')
    expect(text).not.toContain('[Page 0 diff]')
    expect(text).not.toContain('Additional context')
    expect(text).not.toContain('DIFF_BODY_MARKER')
  })

  it('returns change counts only for diff="summary"', async () => {
    const result = await executeTool(
      act,
      { page: 0, kind: 'focus', ref: 'e1', diff: 'summary' },
      { session: mockSession(DIFF) },
    )
    const text = textOf(result)
    expect(text).toContain('[Page 0 diff]')
    expect(text).toContain('3 added, 1 removed')
    expect(text).not.toContain('DIFF_BODY_MARKER')
  })
})

describe('act fill cancellation', () => {
  it('does not dispatch later field fills after abort during an in-flight fill', async () => {
    let releaseFirstFill!: () => void
    const firstFill = new Promise<void>((resolve) => {
      releaseFirstFill = resolve
    })
    const fillCalls: string[] = []
    const controller = new AbortController()
    const execution = executeTool(
      act,
      {
        page: 0,
        kind: 'fill',
        fields: [
          { ref: 'e1', value: 'first' },
          { ref: 'e2', value: 'second' },
        ],
        diff: 'none',
      },
      {
        session: mockSession(DIFF, async (ref) => {
          fillCalls.push(ref)
          if (ref === 'e1') await firstFill
        }),
        signal: controller.signal,
      },
    )

    await Promise.resolve()
    expect(fillCalls).toEqual(['e1'])
    controller.abort()
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })

    // The dispatched first fill cannot be recalled; once it settles, the handler
    // must observe cancellation before it dispatches the next field.
    releaseFirstFill()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fillCalls).toEqual(['e1'])
  })
})
