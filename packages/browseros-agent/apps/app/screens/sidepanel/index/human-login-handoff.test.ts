import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HumanLoginHandoffNotice } from './HumanLoginHandoff'
import {
  continuationTabs,
  findAttachedLoginTab,
  humanLoginContinuationPrompt,
  isLocalMfaFixtureUrl,
  queryContinuationTabs,
  sendContinuationForConversation,
  sendHumanLoginContinuation,
  startHumanLoginHandoff,
} from './human-login-handoff'

describe('human login handoff', () => {
  it('recognizes only the exact dummy MFA path on loopback hosts', () => {
    for (const url of [
      'http://localhost:4173/mfa-login.html',
      'https://127.0.0.1/mfa-login.html',
      'http://[::1]:4173/mfa-login.html',
    ]) {
      expect(isLocalMfaFixtureUrl(url)).toBe(true)
    }
    for (const url of [
      'https://example.test/mfa-login.html',
      'http://localhost.evil.test/mfa-login.html',
      'http://127.0.0.1.example.test/mfa-login.html',
      'http://localhost/mfa-login.html/extra',
      'http://localhost/other.html',
      'file:///mfa-login.html',
      'not a URL',
    ]) {
      expect(isLocalMfaFixtureUrl(url)).toBe(false)
    }
  })

  it('only selects an attached HTTP(S) tab from the queried current window', () => {
    const attached = [{ id: 4, url: 'https://login.test' }]
    expect(
      findAttachedLoginTab(
        [
          { id: 1, url: 'https://other.test' },
          { id: 2, url: 'chrome://settings' },
          { id: 3, url: 'file:///login' },
          { id: 4, url: 'https://login.test' },
        ],
        attached,
      ),
    ).toEqual({ id: 4, url: 'https://login.test' })
    expect(
      findAttachedLoginTab([{ id: 2, url: 'https://login.test' }], []),
    ).toBeUndefined()
  })

  it('stops before querying and activates only the selected tab', async () => {
    const events: string[] = []
    const activated = await startHumanLoginHandoff(
      () => events.push('stop'),
      [{ id: 7, url: 'https://login.test' }],
      {
        query: async (query) => {
          expect(query).toEqual({ currentWindow: true })
          events.push('query')
          return [{ id: 7, url: 'https://login.test' }]
        },
        update: async (id, properties) => {
          events.push(`activate:${id}:${String(properties.active)}`)
          return {} as chrome.tabs.Tab
        },
      },
    )
    expect(activated).toBe(true)
    expect(events).toEqual(['stop', 'query', 'activate:7:true'])
  })

  it('does not activate tabs when none are attached to the current window', async () => {
    const updates: number[] = []
    const activated = await startHumanLoginHandoff(
      () => {},
      [{ id: 7, url: 'https://login.test' }],
      {
        query: async () => [{ id: 8, url: 'https://login.test' }],
        update: async (id) => {
          updates.push(id)
          return {} as chrome.tabs.Tab
        },
      },
    )
    expect(activated).toBe(false)
    expect(updates).toEqual([])
  })

  it('sends a fresh continuation that inspects state and forbids replay or secrets', async () => {
    let sent = ''
    const status = await sendHumanLoginContinuation((prompt) => {
      sent = prompt
      return true
    })
    expect(status).toBe('accepted')
    expect(sent).toBe(humanLoginContinuationPrompt())
    expect(sent).toContain('fresh turn')
    expect(sent).toContain('inspect the current browser state')
    expect(sent).toContain('Please do not replay, retry, or submit any action')
    expect(sent).toContain('This is an advisory request')
    expect(sent).toContain('Do not ask me for, repeat, or include passwords')
  })

  it('reports a refused continuation without changing stopped-run semantics', async () => {
    let called = false
    const status = await sendHumanLoginContinuation(() => {
      called = true
      return false
    })
    expect(called).toBe(true)
    expect(status).toBe('rejected')
  })

  it('uses the manually selected active page when no attached page is available', () => {
    expect(
      continuationTabs(
        [],
        [
          { id: 8, url: 'https://login.test', active: true },
          { id: 9, url: 'chrome://settings', active: false },
        ],
      ),
    ).toEqual([{ id: 8, url: 'https://login.test', active: true }])
    expect(
      continuationTabs(
        [{ id: 7, url: 'https://attached.test', active: false }],
        [
          { id: 7, url: 'https://attached.test/live', active: false },
          { id: 8, url: 'https://login.test', active: true },
        ],
      ),
    ).toEqual([{ id: 7, url: 'https://attached.test/live', active: false }])
  })

  it('ignores stale or out-of-window attachments and falls back to the live active page', () => {
    expect(
      continuationTabs(
        [{ id: 7, url: 'https://stale.test' }],
        [{ id: 8, url: 'https://active.test', active: true }],
      ),
    ).toEqual([{ id: 8, url: 'https://active.test', active: true }])
  })

  it('queries live tabs even when cached attachments are non-empty', async () => {
    let queries = 0
    const liveTabs: { id: number; url: string; active?: boolean }[] = [
      { id: 8, url: 'https://active.test', active: true },
    ]
    const tabs = await queryContinuationTabs<{
      id: number
      url: string
      active?: boolean
    }>([{ id: 7, url: 'https://stale.test' }], async () => {
      queries += 1
      return liveTabs
    })

    expect(queries).toBe(1)
    expect(tabs).toEqual([{ id: 8, url: 'https://active.test', active: true }])
    expect(tabs.some((tab) => tab.id === 7)).toBe(false)
  })

  it('does not send a pending continuation after switching conversations', async () => {
    let currentConversationId = 'conversation-a'
    let resolveTarget!: (target: string) => void
    let sends = 0
    const pendingTarget = new Promise<string>((resolve) => {
      resolveTarget = resolve
    })
    const continuation = sendContinuationForConversation(
      'conversation-a',
      () => currentConversationId,
      () => pendingTarget,
      () => {
        sends += 1
        return true
      },
    )

    currentConversationId = 'conversation-b'
    resolveTarget('live target')

    expect(await continuation).toBe(false)
    expect(sends).toBe(0)
  })

  it('shows manual-switch guidance and truthful accepted/rejected UI states', () => {
    const renderNotice = (continuationStatus: 'accepted' | 'rejected' | null) =>
      renderToStaticMarkup(
        createElement(HumanLoginHandoffNotice, {
          warning:
            'No attached login tab is available in this window. Switch to the login tab manually. No credentials were accessed.',
          continuationStatus,
          onContinue: () => {},
          onClose: () => {},
        }),
      )

    const accepted = renderNotice('accepted')
    expect(accepted).toContain('Switch to the login tab manually')
    expect(accepted).toContain('Continue after I’m done')
    expect(accepted).toContain('Fresh continuation sent or queued')
    expect(accepted).toContain('This request is advisory, not enforced')
    expect(accepted).toContain('disabled=""')

    const rejected = renderNotice('rejected')
    expect(rejected).toContain('The continuation was not sent')
    expect(rejected).toContain('Make sure the verified page is active')
    expect(rejected).not.toContain('disabled=""')
  })

  it('qualifies the fixture route match and explains stop plus fresh turn', () => {
    const notice = renderToStaticMarkup(
      createElement(HumanLoginHandoffNotice, {
        warning: null,
        localMfaFixture: true,
        continuationStatus: null,
        onContinue: () => {},
        onClose: () => {},
      }),
    )
    expect(notice).toContain('local dummy MFA fixture')
    expect(notice).toContain('Confirm you launched the captcha testbed')
    expect(notice).toContain('before using fake values')
    expect(notice).toContain('another local service could use the same path')
    expect(notice).toContain('Stop is required before the tab opens')
    expect(notice).toContain('continuing starts a fresh advisory turn')
    expect(notice).toContain('stopped run cannot resume')
  })
})
