import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { AXNode } from '@browseros/browser-core/core/snapshot/ax-types'
import { diffSnapshots } from '@browseros/browser-core/core/snapshot/diff'
import { RefMap } from '@browseros/browser-core/core/snapshot/refs'
import { renderSnapshot } from '@browseros/browser-core/core/snapshot/render'
import { diff } from './diff'
import { executeTool } from './framework'
import { grep } from './grep'
import { snapshot } from './snapshot'

function resultText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return ''
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
}

function snapshotWithPassword(value: string): string {
  const nodes: AXNode[] = [
    {
      nodeId: 'root',
      role: { type: 'role', value: 'RootWebArea' },
      childIds: ['password'],
    },
    {
      nodeId: 'password',
      role: { type: 'role', value: 'textbox' },
      name: { type: 'computedString', value: 'Password' },
      value: { type: 'string', value },
      backendDOMNodeId: 7,
    },
  ]
  return renderSnapshot(nodes, { refs: new RefMap() }).text
}

describe('password redaction at browser tool boundary', () => {
  it('keeps cleartext AX password values out of snapshot, diff, and AX grep results', async () => {
    const sentinel = 'browser-mcp-password-sentinel-d132'
    const before = snapshotWithPassword(sentinel)
    const after = snapshotWithPassword(`${sentinel}-updated`)
    const session = {
      observe: () => ({
        snapshot: async () => ({ text: after }),
        diff: async () => diffSnapshots(before, after),
      }),
      pages: { getInfo: () => ({ url: 'https://example.com/' }) },
    } as unknown as BrowserSession
    const ctx = { session }

    const [snapshotResult, diffResult, grepResult] = await Promise.all([
      executeTool(snapshot, { page: 1 }, ctx),
      executeTool(diff, { page: 1 }, ctx),
      executeTool(grep, { page: 1, pattern: sentinel, over: 'ax' }, ctx),
    ])

    for (const result of [snapshotResult, diffResult, grepResult]) {
      expect(resultText(result)).not.toContain(sentinel)
      expect(JSON.stringify(result.structuredContent ?? {})).not.toContain(
        sentinel,
      )
    }
    expect(grepResult.structuredContent).toMatchObject({
      count: 0,
      matches: [],
    })
  })
})
