import { buildContentMarkdownExpression } from '@browseros/browser-core/content-markdown'
import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import { z } from 'zod/v4'
import {
  defineTool,
  errorResult,
  textResult,
  throwIfAborted,
} from './framework'
import { writeTempToolOutputFile } from './output-file'
import { wrapUntrusted } from './trust-boundary'

async function mainFrameLoaderId(session: {
  Page?: { getFrameTree?: () => Promise<unknown> }
}): Promise<string | undefined> {
  try {
    const result = (await session.Page?.getFrameTree?.()) as
      | { frameTree?: { frame?: { loaderId?: string } } }
      | undefined
    return result?.frameTree?.frame?.loaderId
  } catch {
    return undefined
  }
}

function connectionEpoch(session: { connectionEpoch?: () => number }) {
  return session.connectionEpoch?.()
}

function expressionFor(
  format: 'markdown' | 'text' | 'links',
  selector?: string,
): string {
  if (format === 'markdown') return buildContentMarkdownExpression({ selector })
  const root = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : 'document.body'
  if (format === 'text') return `((${root})?.innerText ?? '')`
  return `[...(${root}?.querySelectorAll('a[href]') ?? [])].map(function(a){return '[' + (a.textContent||'').trim() + '](' + a.href + ')'}).join('\\n')`
}

export const read = defineTool({
  name: 'read',
  description:
    'Extract page content as markdown (default), plain text, or a list of links. For reading/scraping, not acting.',
  input: z
    .object({
      page: z.number().int(),
      format: z.enum(['markdown', 'text', 'links']).default('markdown'),
      selector: z.string().optional().describe('Restrict to a CSS subtree.'),
      viewportOnly: z
        .boolean()
        .optional()
        .describe('For markdown reads, include only visible viewport content.'),
      includeLinks: z
        .boolean()
        .optional()
        .describe('For markdown reads, render links as markdown links.'),
      includeImages: z
        .boolean()
        .optional()
        .describe('For markdown reads, include image references.'),
    })
    .strict(),
  annotations: { title: 'Read page content', readOnlyHint: true },
  handler: async (args, ctx) => {
    throwIfAborted(ctx.signal)
    const epochBefore = connectionEpoch(ctx.session)
    const pageSession = await ctx.session.pages.getSession(args.page)
    throwIfAborted(ctx.signal)
    const { session } = pageSession
    const loaderBefore = await mainFrameLoaderId(session)
    if (!loaderBefore) {
      return errorResult(
        'read: cannot verify selected document identity; retry',
      )
    }
    throwIfAborted(ctx.signal)
    const code =
      args.format === 'markdown'
        ? buildContentMarkdownExpression({
            selector: args.selector,
            viewportOnly: args.viewportOnly,
            includeLinks: args.includeLinks,
            includeImages: args.includeImages,
          })
        : expressionFor(args.format, args.selector)
    const result = await session.Runtime.evaluate({
      expression: code,
      returnByValue: true,
    })
    throwIfAborted(ctx.signal)
    if (result.exceptionDetails) {
      return errorResult(
        `read: ${
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
        }`,
      )
    }

    // Refresh from the browser after evaluation: getInfo() alone can be stale
    // while navigation or tab replacement is in flight.
    const currentPage = await ctx.session.pages.refresh(args.page)
    throwIfAborted(ctx.signal)
    const loaderAfter = await mainFrameLoaderId(session)
    if (!loaderAfter) {
      return errorResult(
        'read: cannot verify selected document identity after read; retry',
      )
    }
    if (
      (epochBefore !== undefined &&
        connectionEpoch(ctx.session) !== epochBefore) ||
      !currentPage ||
      currentPage.pageId !== args.page ||
      currentPage.targetId !== pageSession.targetId ||
      currentPage.url !== pageSession.url ||
      loaderBefore !== loaderAfter
    ) {
      return errorResult(
        `read: page ${args.page} navigated, changed, or closed during read; retry`,
      )
    }

    const value = result.result?.value
    if (typeof value !== 'string') {
      return errorResult('read: CDP returned no page text; retry')
    }
    const text = value
    const origin = pageSession.url
    const structured = {
      page: args.page,
      format: args.format,
      url: origin,
      ...(pageSession.targetId && { targetId: pageSession.targetId }),
    }

    if (text.length <= TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS) {
      return textResult(wrapUntrusted(text || '(empty)', origin), {
        ...structured,
        contentLength: text.length,
        writtenToFile: false,
      })
    }

    throwIfAborted(ctx.signal)
    const path = await writeTempToolOutputFile({
      toolName: 'read',
      extension: args.format === 'markdown' ? 'md' : 'txt',
      content: wrapUntrusted(text, origin),
    })
    throwIfAborted(ctx.signal)
    const truncated = text.slice(0, TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS)
    return textResult(
      [
        wrapUntrusted(truncated, origin),
        `Content truncated at ${TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS} chars. Full content (${text.length} chars) saved to: ${path}`,
      ].join('\n\n'),
      {
        ...structured,
        path,
        contentLength: text.length,
        writtenToFile: true,
      },
    )
  },
})
