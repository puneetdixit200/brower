import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import { z } from 'zod/v4'
import { getToolOutputDir } from '../tool-output-dir'
import { defineTool, textResult } from './framework'
import { recordBrowserOutputArtifact } from './output-file'

async function hashDownloadedFile(path: string) {
  const before = await stat(path)
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
    sizeBytes += chunk.byteLength
  }
  const after = await stat(path)
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    sizeBytes !== after.size
  ) {
    throw new Error('The downloaded file changed while it was being recorded.')
  }
  return { sizeBytes, sha256: hash.digest('hex') }
}

export const download = defineTool({
  name: 'download',
  description:
    'Click an element (by ref from the last snapshot) to trigger a file download, and save it to a BrowserOS output file. Returns the saved path and filename.',
  input: z
    .object({
      page: z.number().int().describe('Page id from `tabs`.'),
      ref: z
        .string()
        .describe('Ref of the element that triggers the download, e.g. "e12".'),
    })
    .strict(),
  annotations: {
    title: 'Download from page',
    destructiveHint: true,
  },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    // A fresh subdir avoids Chromium filename uniquifying on repeated downloads.
    const dir = await mkdtemp(join(await getToolOutputDir(), 'download-'))

    const { suggestedFilename } = await captureDownload(session, dir, () =>
      ctx.session.input(args.page).click(args.ref),
    )
    const safeFilename = basename(suggestedFilename.replaceAll('\\', '/'))
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('The downloaded filename is invalid.')
    }
    const path = join(dir, safeFilename)
    const digest = await hashDownloadedFile(path)
    const artifact = {
      filename: safeFilename,
      ...digest,
    }
    const artifactId = recordBrowserOutputArtifact({ path, ...artifact })
    return textResult(`Downloaded "${suggestedFilename}" to: ${path}`, {
      artifact: { ...artifact, artifactId },
    })
  },
})

/** Arms page download capture, runs the trigger, and resolves when the download completes. */
async function captureDownload(
  session: ProtocolApi,
  downloadPath: string,
  trigger: () => Promise<void>,
): Promise<{ suggestedFilename: string }> {
  await session.Page.setDownloadBehavior({ behavior: 'allow', downloadPath })

  return new Promise<{ suggestedFilename: string }>((resolve, reject) => {
    let guid = ''
    let suggestedFilename = ''

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Download timed out after ${TIMEOUTS.DOWNLOAD}ms`))
    }, TIMEOUTS.DOWNLOAD)

    const unsubscribeBegin = session.Page.on('downloadWillBegin', (params) => {
      guid = params.guid
      suggestedFilename = params.suggestedFilename
    })

    const unsubscribeProgress = session.Page.on(
      'downloadProgress',
      (params) => {
        if (params.guid !== guid) return
        if (params.state === 'completed') {
          cleanup()
          resolve({ suggestedFilename })
        } else if (params.state === 'canceled') {
          cleanup()
          reject(new Error('Download was canceled'))
        }
      },
    )

    const cleanup = () => {
      clearTimeout(timer)
      unsubscribeBegin()
      unsubscribeProgress()
      session.Page.setDownloadBehavior({ behavior: 'default' }).catch(() => {})
    }

    trigger().catch((err) => {
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}
