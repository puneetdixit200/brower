import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { read } from './read'

function sessionWithRead(result: unknown): BrowserSession {
  return {
    pages: {
      getSession: async () => ({
        targetId: 'target-a',
        url: 'https://example.com/article?edition=1',
        session: {
          Page: {
            getFrameTree: async () => ({
              frameTree: { frame: { loaderId: 'loader-a' } },
            }),
          },
          Runtime: { evaluate: async () => result },
        },
      }),
      getInfo: () => ({
        pageId: 7,
        targetId: 'target-a',
        url: 'https://example.com/article?edition=1',
      }),
      refresh: async () => ({
        pageId: 7,
        targetId: 'target-a',
        url: 'https://example.com/article?edition=1',
      }),
    },
    connectionEpoch: () => 1,
  } as unknown as BrowserSession
}

describe('read tool source URL metadata', () => {
  it('returns the current page URL in structured output after a successful read', async () => {
    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session: sessionWithRead({ result: { value: 'Page contents' } }) },
    )

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toMatchObject({
      page: 7,
      format: 'text',
      url: 'https://example.com/article?edition=1',
      writtenToFile: false,
    })
  })

  it('does not return a source URL when the page read fails', async () => {
    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      {
        session: sessionWithRead({
          exceptionDetails: { text: 'read failed' },
        }),
      },
    )

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
  })

  it('does not use stale cached identity when refresh reports a closed page', async () => {
    const session = sessionWithRead({
      result: { value: 'possibly stale text' },
    })
    ;(
      session.pages as unknown as { refresh: () => Promise<undefined> }
    ).refresh = async () => undefined

    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
  })

  it('does not report success when CDP has no string value', async () => {
    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session: sessionWithRead({ result: {} }) },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'read: CDP returned no page text; retry',
    })
    expect(result.structuredContent).toBeUndefined()
  })

  it('fails closed when the main-frame loader identity cannot be verified', async () => {
    let evaluateCalled = false
    const session = sessionWithRead({ result: { value: 'unverified content' } })
    ;(
      session.pages as unknown as {
        getSession: () => Promise<{
          targetId: string
          url: string
          session: { Runtime: { evaluate: () => Promise<unknown> } }
        }>
      }
    ).getSession = async () => ({
      targetId: 'target-a',
      url: 'https://example.com/article?edition=1',
      session: {
        Runtime: {
          evaluate: async () => {
            evaluateCalled = true
            return { result: { value: 'unverified content' } }
          },
        },
      },
    })

    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'read: cannot verify selected document identity; retry',
    })
    expect(evaluateCalled).toBe(false)
    expect(result.structuredContent).toBeUndefined()
  })

  it('fails closed if the loader identity disappears after evaluation', async () => {
    let frameTreeCalls = 0
    const session = sessionWithRead({ result: { value: 'unverified content' } })
    ;(
      session.pages as unknown as {
        getSession: () => Promise<{
          targetId: string
          url: string
          session: {
            Page: { getFrameTree: () => Promise<unknown> }
            Runtime: { evaluate: () => Promise<unknown> }
          }
        }>
      }
    ).getSession = async () => ({
      targetId: 'target-a',
      url: 'https://example.com/article?edition=1',
      session: {
        Page: {
          getFrameTree: async () => {
            frameTreeCalls += 1
            return frameTreeCalls === 1
              ? { frameTree: { frame: { loaderId: 'loader-a' } } }
              : { frameTree: { frame: {} } }
          },
        },
        Runtime: {
          evaluate: async () => ({
            result: { value: 'unverified content' },
          }),
        },
      },
    })

    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'read: cannot verify selected document identity after read; retry',
    })
    expect(result.structuredContent).toBeUndefined()
  })

  it('rejects content if CDP reconnects during evaluation', async () => {
    let epoch = 1
    const session = sessionWithRead({
      result: { value: 'old connection text' },
    })
    ;(session as unknown as { connectionEpoch: () => number }).connectionEpoch =
      () => epoch
    ;(
      session.pages as unknown as {
        getSession: () => Promise<{
          targetId: string
          url: string
          session: { Runtime: { evaluate: () => Promise<unknown> } }
        }>
      }
    ).getSession = async () => ({
      targetId: 'target-a',
      url: 'https://example.com/article?edition=1',
      session: {
        Page: {
          getFrameTree: async () => ({
            frameTree: { frame: { loaderId: 'loader-a' } },
          }),
        },
        Runtime: {
          evaluate: async () => {
            epoch = 2
            return { result: { value: 'old connection text' } }
          },
        },
      },
    })

    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session },
    )

    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
  })

  it('rejects content if the selected page ID is rebound during evaluation', async () => {
    let current = { pageId: 7, targetId: 'target-a', url: 'https://a.example' }
    let finish!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve
    })
    const session = {
      pages: {
        getSession: async () => ({
          targetId: 'target-a',
          url: 'https://a.example',
          session: {
            Page: {
              getFrameTree: async () => ({
                frameTree: { frame: { loaderId: 'loader-a' } },
              }),
            },
            Runtime: { evaluate: async () => pending },
          },
        }),
        getInfo: () => current,
        refresh: async () => current,
      },
    } as unknown as BrowserSession

    const reading = executeTool(read, { page: 7, format: 'text' }, { session })
    current = { pageId: 7, targetId: 'target-b', url: 'https://b.example' }
    finish({ result: { value: 'content from A' } })

    const result = await reading
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'read: page 7 navigated, changed, or closed during read; retry',
      },
    ])
    expect(result.structuredContent).toBeUndefined()
  })

  it('rejects a same-target read if refresh finds navigation during evaluation', async () => {
    let livePage = {
      pageId: 7,
      targetId: 'target-a',
      url: 'https://a.example/start',
    }
    let finish!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve
    })
    const staleCache = { ...livePage }
    const session = {
      pages: {
        getSession: async () => ({
          targetId: 'target-a',
          url: 'https://a.example/start',
          session: {
            Page: {
              getFrameTree: async () => ({
                frameTree: { frame: { loaderId: 'loader-a' } },
              }),
            },
            Runtime: { evaluate: async () => pending },
          },
        }),
        getInfo: () => staleCache,
        refresh: async () => livePage,
      },
    } as unknown as BrowserSession

    const reading = executeTool(read, { page: 7, format: 'text' }, { session })
    livePage = {
      pageId: 7,
      targetId: 'target-a',
      url: 'https://b.example/after-navigation',
    }
    finish({ result: { value: 'content after navigation' } })

    const result = await reading
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'read: page 7 navigated, changed, or closed during read; retry',
      },
    ])
    expect(result.structuredContent).toBeUndefined()
  })

  it('rejects a same-URL reload when the main frame loader changes', async () => {
    let loaderId = 'loader-before'
    let finish!: (value: unknown) => void
    let markEvaluateStarted!: () => void
    const evaluateStarted = new Promise<void>((resolve) => {
      markEvaluateStarted = resolve
    })
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve
    })
    const page = {
      pageId: 7,
      targetId: 'target-a',
      url: 'https://a.example/same-url',
    }
    const session = {
      pages: {
        getSession: async () => ({
          targetId: page.targetId,
          url: page.url,
          session: {
            Page: {
              getFrameTree: async () => ({
                frameTree: { frame: { loaderId } },
              }),
            },
            Runtime: {
              evaluate: async () => {
                markEvaluateStarted()
                return pending
              },
            },
          },
        }),
        getInfo: () => page,
        refresh: async () => page,
      },
    } as unknown as BrowserSession

    const reading = executeTool(read, { page: 7, format: 'text' }, { session })
    await evaluateStarted
    loaderId = 'loader-after-reload'
    finish({ result: { value: 'content from reloaded document' } })

    const result = await reading
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'read: page 7 navigated, changed, or closed during read; retry',
      },
    ])
    expect(result.structuredContent).toBeUndefined()
  })

  it('attributes a successful read to the target that supplied its content', async () => {
    const session = sessionWithRead({ result: { value: 'Page contents' } })
    const pageSession = async () => ({
      targetId: 'target-source',
      url: 'https://source.example/article',
      session: {
        Page: {
          getFrameTree: async () => ({
            frameTree: { frame: { loaderId: 'loader-source' } },
          }),
        },
        Runtime: {
          evaluate: async () => ({ result: { value: 'Page contents' } }),
        },
      },
    })
    ;(
      session.pages as unknown as { getSession: typeof pageSession }
    ).getSession = pageSession
    ;(session.pages as unknown as { getInfo: () => unknown }).getInfo = () => ({
      pageId: 7,
      targetId: 'target-source',
      url: 'https://source.example/article',
    })
    ;(session.pages as unknown as { refresh: () => Promise<unknown> }).refresh =
      async () => ({
        pageId: 7,
        targetId: 'target-source',
        url: 'https://source.example/article',
      })

    const result = await executeTool(
      read,
      { page: 7, format: 'text' },
      { session },
    )
    expect(result.structuredContent).toMatchObject({
      page: 7,
      targetId: 'target-source',
      url: 'https://source.example/article',
    })
  })
})
