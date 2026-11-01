import { describe, expect, it } from 'bun:test'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import {
  MAX_LOAD_TIMEOUT_MS,
  Navigation,
  normalizeLoadTimeoutMs,
} from './navigation'
import type { PageManager } from './pages'

describe('Navigation', () => {
  it('rejects invalid timeouts and caps huge finite timeouts', () => {
    const pages = {} as PageManager
    for (const timeout of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
    ]) {
      expect(() => new Navigation(pages, 1, timeout)).toThrow(RangeError)
    }
    expect(normalizeLoadTimeoutMs(Number.MAX_VALUE)).toBe(MAX_LOAD_TIMEOUT_MS)
    expect(() => new Navigation(pages, 1, Number.MAX_VALUE)).not.toThrow()
  })

  it('fails instead of reporting success when the page stays pending', async () => {
    let dispatchedUrl: string | undefined
    const session = {
      Page: {
        navigate: async ({ url }: { url: string }) => {
          dispatchedUrl = url
          return {}
        },
      },
      Runtime: {
        evaluate: async () => ({ result: { value: 'loading' } }),
      },
    } as unknown as ProtocolApi
    const pages = {
      getSession: async () => ({
        targetId: 'target-1',
        sessionId: 'session-1',
        session,
        url: 'https://before.example/',
      }),
    } as unknown as PageManager

    await expect(
      new Navigation(pages, 1, 80).goto('https://pending.example/'),
    ).rejects.toThrow('Navigation timed out after 80 ms after dispatch')
    expect(dispatchedUrl).toBe('https://pending.example/')
  })

  it('bounds a Runtime.evaluate call that never settles by the overall deadline', async () => {
    let settleEvaluation!: (value: { result: { value: string } }) => void
    let evaluationCalls = 0
    const session = {
      Page: { navigate: async () => ({}) },
      Runtime: {
        evaluate: () => {
          evaluationCalls++
          return new Promise<{ result: { value: string } }>((resolve) => {
            settleEvaluation = resolve
          })
        },
      },
    } as unknown as ProtocolApi
    const pages = {
      getSession: async () => ({
        targetId: 'target-1',
        sessionId: 'session-1',
        session,
        url: 'https://before.example/',
      }),
    } as unknown as PageManager

    await expect(
      new Navigation(pages, 1, 80).goto('https://pending.example/'),
    ).rejects.toThrow('Navigation timed out after 80 ms after dispatch')
    expect(evaluationCalls).toBe(1)
    settleEvaluation({ result: { value: 'complete' } })
  })

  it('bounds a history Runtime.evaluate call that never settles', async () => {
    let expression: string | undefined
    const session = {
      Runtime: {
        evaluate: (params: { expression: string }) => {
          expression = params.expression
          return new Promise(() => {})
        },
      },
    } as unknown as ProtocolApi
    const pages = {
      getSession: async () => ({
        targetId: 'target-1',
        sessionId: 'session-1',
        session,
        url: 'https://before.example/',
      }),
    } as unknown as PageManager

    await expect(new Navigation(pages, 1, 80).back()).rejects.toThrow(
      'Navigation timed out after 80 ms after dispatch',
    )
    expect(expression).toBe('history.back()')
  })

  it('does not extend the deadline with a polling delay', async () => {
    const startedAt = Date.now()
    const session = {
      Page: { navigate: async () => ({}) },
      Runtime: {
        evaluate: async () => ({ result: { value: 'loading' } }),
      },
    } as unknown as ProtocolApi
    const pages = {
      getSession: async () => ({
        targetId: 'target-1',
        sessionId: 'session-1',
        session,
        url: 'https://before.example/',
      }),
    } as unknown as PageManager

    await expect(
      new Navigation(pages, 1, 80).goto('https://pending.example/'),
    ).rejects.toThrow('Navigation timed out after 80 ms after dispatch')
    expect(Date.now() - startedAt).toBeLessThan(230)
  })

  it('bounds a Page.navigate call that never settles', async () => {
    let settleNavigate!: () => void
    let navigationCalls = 0
    const session = {
      Page: {
        navigate: () => {
          navigationCalls++
          return new Promise<void>((resolve) => {
            settleNavigate = resolve
          })
        },
      },
    } as unknown as ProtocolApi
    const pages = {
      getSession: async () => ({
        targetId: 'target-1',
        sessionId: 'session-1',
        session,
        url: 'https://before.example/',
      }),
    } as unknown as PageManager

    await expect(
      new Navigation(pages, 1, 80).goto('https://pending.example/'),
    ).rejects.toThrow(
      'Navigation timed out after 80 ms after dispatch; the page may still change.',
    )
    settleNavigate()
    expect(navigationCalls).toBe(1)
  })

  it('bounds a page-session lookup that never settles', async () => {
    const pages = {
      getSession: () => new Promise(() => {}),
    } as unknown as PageManager

    await expect(new Navigation(pages, 1, 80).reload()).rejects.toThrow(
      'Navigation timed out after 80 ms before a navigation command was dispatched',
    )
  })
})
