import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { BrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import { getToolOutputDir } from '../../lib/browseros-dir'
import { isPathInside } from './path-boundary'
import { openWorkspaceRoot, readFileBeneath } from './safe-file'

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024

export type AuthorizedArtifactRead =
  | { kind: 'found'; filename: string; contents: Buffer }
  | { kind: 'missing' }
  | { kind: 'too-large' }

/** Reads only a capability registered by this conversation's output-file access set. */
export async function readAuthorizedBrowserOutputArtifact(
  access: BrowserOutputFileAccess | undefined,
  artifactId: string,
  getOutputRoot: () => Promise<string> = getToolOutputDir,
): Promise<AuthorizedArtifactRead> {
  const descriptor = access?.artifacts.get(artifactId)
  if (!descriptor) return { kind: 'missing' }

  let rootHandle: Awaited<ReturnType<typeof openWorkspaceRoot>> | undefined
  try {
    const outputRoot = await realpath(await getOutputRoot())
    if (
      !isPathInside(outputRoot, descriptor.path) ||
      descriptor.path === outputRoot
    ) {
      return { kind: 'missing' }
    }
    // Pin the output directory, then resolve/read beneath that descriptor. On
    // Linux safe-file uses openat2 with NO_SYMLINKS; its portable POSIX path
    // uses component-wise O_NOFOLLOW and O_NONBLOCK, as documented there.
    rootHandle = await openWorkspaceRoot(outputRoot)
    let contents: Buffer
    try {
      contents = await readFileBeneath(
        outputRoot,
        descriptor.path,
        MAX_ARTIFACT_BYTES,
        rootHandle,
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('permitted read size')
      ) {
        return { kind: 'too-large' }
      }
      return { kind: 'missing' }
    }
    if (
      contents.byteLength !== descriptor.sizeBytes ||
      createHash('sha256').update(contents).digest('hex') !== descriptor.sha256
    )
      return { kind: 'missing' }
    return { kind: 'found', filename: descriptor.filename, contents }
  } catch {
    return { kind: 'missing' }
  } finally {
    await rootHandle?.close()
  }
}
