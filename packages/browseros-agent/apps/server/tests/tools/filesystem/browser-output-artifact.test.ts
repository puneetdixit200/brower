import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import { readAuthorizedBrowserOutputArtifact } from '../../../src/tools/filesystem/browser-output-artifact'

const tempRoots: string[] = []

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'aster-artifact-'))
  tempRoots.push(root)
  const output = join(root, 'tool-output')
  await mkdir(output)
  return { root, output }
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('readAuthorizedBrowserOutputArtifact', () => {
  it('returns a registered, hash-matching file only through its owning access set', async () => {
    const { output } = await makeRoot()
    const path = join(output, 'download.bin')
    const contents = Buffer.from('download payload')
    await writeFile(path, contents)
    const access = createBrowserOutputFileAccess()
    const artifactId = access.recordArtifact({
      path,
      filename: 'download.bin',
      sizeBytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    })

    const result = await readAuthorizedBrowserOutputArtifact(
      access,
      artifactId,
      async () => output,
    )
    expect(result.kind).toBe('found')
    if (result.kind === 'found') expect(result.contents).toEqual(contents)
    expect(
      (
        await readAuthorizedBrowserOutputArtifact(
          createBrowserOutputFileAccess(),
          artifactId,
          async () => output,
        )
      ).kind,
    ).toBe('missing')
  })

  it('rejects modified files and paths outside the output root', async () => {
    const { root, output } = await makeRoot()
    const changedPath = join(output, 'changed.bin')
    await writeFile(changedPath, 'changed')
    const changedAccess = createBrowserOutputFileAccess()
    const changedId = changedAccess.recordArtifact({
      path: changedPath,
      filename: 'changed.bin',
      sizeBytes: 7,
      sha256: createHash('sha256').update('original').digest('hex'),
    })
    expect(
      (
        await readAuthorizedBrowserOutputArtifact(
          changedAccess,
          changedId,
          async () => output,
        )
      ).kind,
    ).toBe('missing')

    const outside = join(root, 'outside.bin')
    await writeFile(outside, 'outside')
    const outsideAccess = createBrowserOutputFileAccess()
    const outsideId = outsideAccess.recordArtifact({
      path: outside,
      filename: 'outside.bin',
      sizeBytes: 7,
      sha256: createHash('sha256').update('outside').digest('hex'),
    })
    expect(
      (
        await readAuthorizedBrowserOutputArtifact(
          outsideAccess,
          outsideId,
          async () => output,
        )
      ).kind,
    ).toBe('missing')
  })

  it('rejects a symlink inside the output root that targets outside it', async () => {
    const { root, output } = await makeRoot()
    const outside = join(root, 'outside.bin')
    const linkPath = join(output, 'linked.bin')
    await writeFile(outside, 'outside')
    await symlink(outside, linkPath)
    const access = createBrowserOutputFileAccess()
    const artifactId = access.recordArtifact({
      path: linkPath,
      filename: 'linked.bin',
      sizeBytes: 7,
      sha256: createHash('sha256').update('outside').digest('hex'),
    })
    expect(
      (
        await readAuthorizedBrowserOutputArtifact(
          access,
          artifactId,
          async () => output,
        )
      ).kind,
    ).toBe('missing')
  })
})
