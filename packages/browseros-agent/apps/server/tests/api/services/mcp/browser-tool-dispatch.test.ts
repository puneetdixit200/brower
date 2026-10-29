import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { defineTool, textResult } from '@browseros/browser-mcp/tools/framework'
import { z } from 'zod/v4'
import type { BrowserToolCall } from '../../../../src/api/services/mcp/browser-tool-dispatch'
import {
  dispatchBrowserTool,
  pauseForDetectedHumanChallenge,
} from '../../../../src/api/services/mcp/browser-tool-dispatch'

const CAPTCHA_SIGNALS = {
  urlOrigin: 'https://example.com',
  urlPath: '/',
  visiblePasswordInputCount: 0,
  visibleOtpInputCount: 0,
  captchaIframeCount: 1,
  captchaProviderMarkerCount: 1,
  explicitChallengeState: 'captcha',
  formState: 'unknown',
} as const

describe('automatic human challenge pause', () => {
  it('integrates snapshot detection into dispatch and waits before returning to the model', async () => {
    const sequence: string[] = []
    const tool = defineTool({
      name: 'snapshot',
      description: 'test snapshot',
      input: z.object({ page: z.number() }),
      annotations: { readOnlyHint: true },
      handler: async () => {
        sequence.push('snapshot')
        return textResult('safe snapshot')
      },
    })
    const session = {
      pages: { getTabId: () => undefined },
      challengeSignals: async () => CAPTCHA_SIGNALS,
    } as unknown as BrowserSession
    const call = {
      tool,
      args: { page: 7 },
      context: { session },
      run: {
        signal: new AbortController().signal,
        waitForHumanIntervention: async () => {
          sequence.push('human-resumed')
        },
      },
      readOnly: true,
      source: 'chat',
      tabGroups: { addCreatedPages: () => {} },
    }

    const result = await dispatchBrowserTool(call)
    expect(sequence).toEqual(['snapshot', 'human-resumed'])
    expect(result.content).toEqual([{ type: 'text', text: 'safe snapshot' }])
  })

  it('pauses the exact run for agreeing challenge signals without changing tool output', async () => {
    let waits = 0
    let reads = 0
    const call = makeCall({
      signal: CAPTCHA_SIGNALS,
      wait: async () => {
        waits += 1
      },
      read: () => {
        reads += 1
      },
    })
    const result = {
      content: [{ type: 'text' as const, text: 'snapshot output' }],
      structuredContent: { page: 7 },
      isError: false,
    }

    await pauseForDetectedHumanChallenge(call, result)

    expect(waits).toBe(1)
    expect(reads).toBe(1)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'snapshot output' }],
      structuredContent: { page: 7 },
      isError: false,
    })
  })

  it('does not pause for URL-only, ambiguous, failed, or non-snapshot evidence', async () => {
    let waits = 0
    const call = makeCall({
      signal: { ...CAPTCHA_SIGNALS, captchaProviderMarkerCount: 0 },
      wait: async () => {
        waits += 1
      },
    })
    await pauseForDetectedHumanChallenge(call, { isError: false })
    await pauseForDetectedHumanChallenge(call, { isError: true })
    await pauseForDetectedHumanChallenge(
      { ...call, tool: { name: 'read' } } as BrowserToolCall,
      { isError: false },
    )
    expect(waits).toBe(0)
  })

  it('does not echo signal values or challenge details into output', async () => {
    let waits = 0
    const call = makeCall({
      signal: {
        ...CAPTCHA_SIGNALS,
        explicitChallengeState: 'unknown',
        urlOrigin: 'https://private.invalid',
      },
      wait: async () => {
        waits += 1
      },
    })
    const result = { content: [{ type: 'text' as const, text: 'safe' }] }
    const serializedBefore = JSON.stringify(result)
    await pauseForDetectedHumanChallenge(call, result)
    expect(waits).toBe(1)
    expect(JSON.stringify(result)).toBe(serializedBefore)
  })
})

function makeCall(options: {
  signal: unknown
  wait: () => Promise<void>
  read?: () => void
}): BrowserToolCall {
  const session = {
    challengeSignals: async () => {
      options.read?.()
      return options.signal
    },
  }
  return {
    tool: { name: 'snapshot' },
    args: { page: 7 },
    context: { session },
    run: { waitForHumanIntervention: options.wait },
  } as unknown as BrowserToolCall
}
