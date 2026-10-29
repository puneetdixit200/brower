import { describe, expect, test } from 'bun:test'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import type { PageManager } from '../pages'
import type { AXNode } from '../snapshot/ax-types'
import type { FrameRegistry } from './frames'
import { Observer } from './observer'

function ax(
  nodeId: string,
  role: string,
  opts: Partial<AXNode> & { children?: string[] } = {},
): AXNode {
  const { children, ...rest } = opts
  return {
    nodeId,
    role: { type: 'role', value: role },
    childIds: children,
    ...rest,
  }
}

function name(value: string): AXNode['name'] {
  return { type: 'computedString', value }
}

interface StubState {
  loaderId: string
  url: string
  nodes: AXNode[]
  childLoaderId?: string
  childNodes?: AXNode[]
  failAxTree?: boolean
  onFrameTreeRead?: () => void
  challengeValue?: unknown
  challengeExpression?: string
}

function stubObserverHarness(state: StubState): Observer {
  const session = {
    Page: {
      getFrameTree: async () => {
        state.onFrameTreeRead?.()
        return {
          frameTree: {
            frame: {
              id: 'main',
              loaderId: state.loaderId,
              url: state.url,
              domainAndRegistry: '',
              securityOrigin: '',
              mimeType: 'text/html',
              secureContextType: 'Secure',
              crossOriginIsolatedContextType: 'NotIsolated',
              gatedAPIFeatures: [],
            },
            childFrames:
              state.childLoaderId === undefined
                ? undefined
                : [
                    {
                      frame: {
                        id: 'child',
                        parentId: 'main',
                        loaderId: state.childLoaderId,
                        url: `${state.url}frame`,
                        domainAndRegistry: '',
                        securityOrigin: '',
                        mimeType: 'text/html',
                        secureContextType: 'Secure',
                        crossOriginIsolatedContextType: 'NotIsolated',
                        gatedAPIFeatures: [],
                      },
                    },
                  ],
          },
        }
      },
    },
    DOM: {
      describeNode: async () => ({
        node: { contentDocument: { frameId: 'child' } },
      }),
    },
    Accessibility: {
      getFullAXTree: async ({ frameId }: { frameId?: string } = {}) => {
        if (state.failAxTree) throw new Error('AX tree failed')
        return {
          nodes: frameId === 'child' ? (state.childNodes ?? []) : state.nodes,
        }
      },
    },
    Runtime: {
      evaluate: async ({ expression }: { expression: string }) => {
        state.challengeExpression = expression
        return { result: { value: state.challengeValue ?? [] } }
      },
    },
  } as unknown as ProtocolApi

  const pages = {
    getSession: async () => ({ targetId: 'target-1', session, url: state.url }),
    refresh: async () => ({ url: state.url }),
  } as unknown as PageManager

  const frames = {
    resolveFrameTarget: (_pageId: number, frameId?: string) => ({
      session,
      axParams: frameId === undefined ? {} : { frameId },
    }),
  } as unknown as FrameRegistry

  return new Observer(pages, frames, 1)
}

describe('Observer stable refs', () => {
  test('projects exactly bounded safe challenge signal fields and caches a copy', async () => {
    const state: StubState = {
      loaderId: 'loader-1',
      url: 'https://example.com/login?token=private#fragment',
      nodes: [],
      challengeValue: {
        visiblePasswordInputCount: 1000,
        visibleOtpInputCount: 2,
        captchaIframeCount: 1,
        captchaProviderMarkerCount: 1,
        explicitChallengeState: 'captcha',
        formState: 'challenge',
        secret: 'must-not-escape',
      },
    }
    const observer = stubObserverHarness(state)
    const signal = await observer.challengeSignals()
    expect(signal).toEqual({
      urlOrigin: 'https://example.com',
      urlPath: '/',
      visiblePasswordInputCount: 20,
      visibleOtpInputCount: 2,
      captchaIframeCount: 1,
      captchaProviderMarkerCount: 1,
      explicitChallengeState: 'captcha',
      formState: 'challenge',
    })
    expect(JSON.stringify(signal)).not.toContain('must-not-escape')
    signal.urlPath = '/mutated'
    expect(observer.lastChallengeSignals?.urlPath).toBe('/')
  })

  test('drops malformed, unsafe, and sensitive URL paths', async () => {
    const state: StubState = {
      loaderId: 'loader-1',
      url: 'javascript:alert(1)',
      nodes: [],
    }
    const observer = stubObserverHarness(state)
    expect(await observer.challengeSignals()).toMatchObject({
      urlOrigin: 'https://invalid.invalid',
      urlPath: '/',
    })
    state.url = 'https://user:pass@example.com/account/session-secret'
    expect(await observer.challengeSignals()).toMatchObject({
      urlOrigin: 'https://invalid.invalid',
      urlPath: '/',
    })
    state.url = 'https://example.com/path/%ZZ'
    expect(await observer.challengeSignals()).toMatchObject({
      urlOrigin: 'https://example.com',
      urlPath: '/',
    })
  })

  test('scanner uses conservative visibility and only allowlisted attributes', async () => {
    const state: StubState = {
      loaderId: 'loader-1',
      url: 'https://example.com',
      nodes: [],
    }
    const observer = stubObserverHarness(state)
    await observer.challengeSignals()
    expect(state.challengeExpression).toContain("el.type==='hidden'")
    expect(state.challengeExpression).toContain(
      "getAttribute('autocomplete')==='one-time-code'",
    )
    expect(state.challengeExpression).toContain("s.visibility!=='visible'")
    expect(state.challengeExpression).toContain(
      "hasAttribute('data-hcaptcha-widget-id')",
    )
    expect(state.challengeExpression).toContain('nodeCap=3000')
    expect(state.challengeExpression).toContain('visited<nodeCap')
    expect(state.challengeExpression).toContain('document.createTreeWalker')
    expect(state.challengeExpression).not.toContain('querySelectorAll')
    expect(state.challengeExpression).not.toContain('innerText')
    expect(state.challengeExpression).not.toContain('placeholder')
  })

  test('snapshot and diff never expose password values returned by AX', async () => {
    const sentinel = 'observer-password-sentinel-93ac'
    const state = {
      loaderId: 'loader-1',
      url: 'https://example.com/',
      nodes: [
        ax('1', 'RootWebArea', { children: ['2'] }),
        ax('2', 'textbox', {
          name: name('Password'),
          backendDOMNodeId: 9,
          value: { type: 'string', value: sentinel },
        }),
      ],
    }
    const observer = stubObserverHarness(state)

    const snapshot = await observer.snapshot()
    state.nodes = [
      ax('1', 'RootWebArea', { children: ['2'] }),
      ax('2', 'textbox', {
        name: name('Password'),
        backendDOMNodeId: 9,
        value: { type: 'string', value: `${sentinel}-changed` },
      }),
    ]
    const diff = await observer.diff()

    expect(snapshot.text).not.toContain(sentinel)
    expect(diff.text).not.toContain(sentinel)
    expect(diff.text).not.toContain(`${sentinel}-changed`)
  })

  test('diff keeps unchanged same-document nodes matched after insertion', async () => {
    const state = {
      loaderId: 'loader-1',
      url: 'https://example.com/',
      nodes: [
        ax('1', 'RootWebArea', { children: ['2', '3'] }),
        ax('2', 'button', { name: name('A'), backendDOMNodeId: 1 }),
        ax('3', 'link', { name: name('B'), backendDOMNodeId: 2 }),
      ],
    }
    const observer = stubObserverHarness(state)

    await observer.snapshot()
    state.nodes = [
      ax('1', 'RootWebArea', { children: ['4', '2', '3'] }),
      ax('4', 'button', { name: name('X'), backendDOMNodeId: 3 }),
      ax('2', 'button', { name: name('A'), backendDOMNodeId: 1 }),
      ax('3', 'link', { name: name('B'), backendDOMNodeId: 2 }),
    ]

    const diff = await observer.diff()

    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(0)
    expect(diff.text).toContain('+ button "X" [ref=e3]')
    expect(diff.text).toContain('1 added, 0 removed')
  })

  test('reload resets the public ref namespace', async () => {
    const state = {
      loaderId: 'loader-1',
      url: 'https://example.com/',
      nodes: [
        ax('1', 'RootWebArea', { children: ['2', '3'] }),
        ax('2', 'button', { name: name('A'), backendDOMNodeId: 1 }),
        ax('3', 'button', { name: name('B'), backendDOMNodeId: 2 }),
      ],
    }
    const observer = stubObserverHarness(state)

    await observer.snapshot()
    state.loaderId = 'loader-2'
    state.nodes = [
      ax('1', 'RootWebArea', { children: ['4'] }),
      ax('4', 'button', { name: name('Reloaded'), backendDOMNodeId: 10 }),
    ]

    const snapshot = await observer.snapshot()

    expect(snapshot.text).toBe('- button "Reloaded" [ref=e1]')
  })

  test('same-document navigation resets the public ref namespace', async () => {
    const state = {
      loaderId: 'loader-1',
      url: 'https://example.com/one',
      nodes: [
        ax('1', 'RootWebArea', { children: ['2', '3'] }),
        ax('2', 'button', { name: name('A'), backendDOMNodeId: 1 }),
        ax('3', 'button', { name: name('B'), backendDOMNodeId: 2 }),
      ],
    }
    const observer = stubObserverHarness(state)

    await observer.snapshot()
    state.url = 'https://example.com/two'
    state.nodes = [
      ax('1', 'RootWebArea', { children: ['4'] }),
      ax('4', 'button', { name: name('Navigated'), backendDOMNodeId: 10 }),
    ]

    const snapshot = await observer.snapshot()

    expect(snapshot.text).toBe('- button "Navigated" [ref=e1]')
  })

  test('failed captures do not replace the last committed refs', async () => {
    const state = {
      loaderId: 'loader-1',
      url: 'https://example.com/',
      nodes: [
        ax('1', 'RootWebArea', { children: ['2'] }),
        ax('2', 'button', { name: name('A'), backendDOMNodeId: 1 }),
      ],
      failAxTree: false,
    }
    const observer = stubObserverHarness(state)

    await observer.snapshot()
    state.failAxTree = true

    await expect(observer.snapshot()).rejects.toThrow('AX tree failed')
    expect(observer.lastRefs.get('e1')).toMatchObject({
      backendNodeId: 1,
      name: 'A',
    })
  })

  test('child-frame document churn falls back without failing the page capture', async () => {
    const state = {
      loaderId: 'loader-1',
      childLoaderId: 'child-loader-1',
      url: 'https://example.com/',
      nodes: [
        ax('1', 'RootWebArea', { children: ['2', '3'] }),
        ax('2', 'button', { name: name('Outer'), backendDOMNodeId: 1 }),
        ax('3', 'Iframe', { backendDOMNodeId: 2 }),
      ],
      childNodes: [
        ax('child-root', 'RootWebArea', { children: ['child-button'] }),
        ax('child-button', 'button', {
          name: name('Inner'),
          backendDOMNodeId: 1,
        }),
      ],
      onFrameTreeRead: undefined as (() => void) | undefined,
    }
    let frameTreeReads = 0
    state.onFrameTreeRead = () => {
      frameTreeReads++
      if (frameTreeReads === 2) state.childLoaderId = 'child-loader-2'
    }
    const observer = stubObserverHarness(state)

    const snapshot = await observer.snapshot()

    expect(snapshot.text).toBe(
      [
        '- button "Outer" [ref=e1]',
        '- iframe',
        '  - button "Inner" [ref=e2]',
      ].join('\n'),
    )
  })
})
