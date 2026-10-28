import { describe, expect, it } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { executeTool } from './framework'
import { read } from './read'

function sessionWithRead(result: unknown): BrowserSession {
  return {
    pages: {
      getSession: async () => ({
        session: { Runtime: { evaluate: async () => result } },
      }),
      getInfo: () => ({ url: 'https://example.com/article?edition=1' }),
    },
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
})
