import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { SnapshotDiff } from '@browseros/browser-core/core/snapshot/diff'
import { ToolResponse } from '../response'
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

describe('act cancellation across action kinds', () => {
  const actions: { args: Record<string, unknown> }[] = [
    { args: { kind: 'click', ref: 'e1' } },
    { args: { kind: 'click_at', x: 1, y: 2 } },
    { args: { kind: 'type', text: 'hello' } },
    { args: { kind: 'type_at', x: 1, y: 2, text: 'hello' } },
    { args: { kind: 'fill', ref: 'e1', value: 'hello' } },
    { args: { kind: 'press', key: 'Enter' } },
    { args: { kind: 'hover', ref: 'e1' } },
    { args: { kind: 'hover_at', x: 1, y: 2 } },
    { args: { kind: 'focus', ref: 'e1' } },
    { args: { kind: 'check', ref: 'e1' } },
    { args: { kind: 'uncheck', ref: 'e1' } },
    { args: { kind: 'select', ref: 'e1', value: 'option' } },
    { args: { kind: 'scroll' } },
    { args: { kind: 'drag', ref: 'e1', targetRef: 'e2' } },
    {
      args: { kind: 'drag_at', startX: 1, startY: 2, endX: 3, endY: 4 },
    },
  ]

  for (const { args } of actions) {
    it(`does not dispatch ${args.kind} when cancelled before dispatch`, async () => {
      const calls: string[] = []
      const controller = new AbortController()
      const session = {
        input: () => {
          // Abort after executeTool has entered the handler, immediately before
          // runKind dispatches the selected action.
          controller.abort()
          return new Proxy(
            {},
            {
              get: (_target, property: string) => async () =>
                calls.push(property),
            },
          )
        },
        observe: () => ({ diff: async () => DIFF }),
        pages: { getInfo: () => ({ url: 'https://example.com/act' }) },
      } as unknown as BrowserSession

      let thrown: unknown
      try {
        await act.handler(
          { page: 0, diff: 'none', ...args },
          { session, signal: controller.signal },
          new ToolResponse(),
        )
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ name: 'AbortError' })
      expect(calls).toEqual([])
    })
  }

  it('does not read back or return success when aborted during an action', async () => {
    let releaseClick!: () => void
    const pendingClick = new Promise<void>((resolve) => {
      releaseClick = resolve
    })
    const controller = new AbortController()
    const calls: string[] = []
    const session = {
      input: () => ({
        click: async () => {
          calls.push('click')
          await pendingClick
        },
      }),
      observe: () => ({
        diff: async () => {
          calls.push('diff')
          return DIFF
        },
      }),
      pages: { getInfo: () => ({ url: 'https://example.com/act' }) },
    } as unknown as BrowserSession
    const execution = executeTool(
      act,
      { page: 0, kind: 'click', ref: 'e1' },
      { session, signal: controller.signal },
    )

    await Promise.resolve()
    expect(calls).toEqual(['click'])
    controller.abort()
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })

    // The in-flight CDP action cannot be recalled; when it settles, cancellation
    // must still prevent success and the automatic diff readback.
    releaseClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(['click'])
  })
})
