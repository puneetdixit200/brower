import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ASTER_BUN_PROVENANCE_RELATIVE_PATH,
  ASTER_BUN_RELATIVE_PATH,
  requireAsterLocalBuildArgs,
  stageAsterBunRuntime,
} from './aster-runtime'

function tempAgentRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aster-runtime-test-'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ engines: { bun: '1.4.2' } }),
  )
  return root
}

test('Aster stages the verified pinned Bun executable with checksum provenance', async () => {
  const root = tempAgentRoot()
  try {
    const provenance = await stageAsterBunRuntime(root)
    const stagedRoot = join(root, 'dist/prod/aster-server/.inputs')
    const runtime = join(stagedRoot, 'bun')
    const sidecar = JSON.parse(
      readFileSync(join(stagedRoot, 'bun-provenance.json'), 'utf8'),
    )
    const digest = createHash('sha256')
      .update(readFileSync(runtime))
      .digest('hex')

    expect(
      execFileSync(runtime, ['--version'], { encoding: 'utf8' }).trim(),
    ).toBe('1.4.2')
    expect(provenance).toEqual(sidecar)
    expect(provenance).toMatchObject({
      schemaVersion: 1,
      version: '1.4.2',
      platform: 'linux',
      arch: 'x64',
      sha256: digest,
    })
    expect(ASTER_BUN_RELATIVE_PATH).toBe('resources/bin/third_party/bun')
    expect(ASTER_BUN_PROVENANCE_RELATIVE_PATH).toBe(
      'resources/bin/third_party/bun.provenance.json',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Aster rejects unsupported hosts and non-Linux binaries', async () => {
  const root = tempAgentRoot()
  const fake = join(root, 'fake-bun')
  writeFileSync(fake, '#!/bin/sh\nprintf 1.4.2\n')
  chmodSync(fake, 0o755)
  try {
    await expect(
      stageAsterBunRuntime(root, fake, { platform: 'linux', arch: 'arm64' }),
    ).rejects.toThrow('Linux x64')
    await expect(
      stageAsterBunRuntime(root, fake, { platform: 'linux', arch: 'x64' }),
    ).rejects.toThrow('Linux x64 ELF')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Aster resource builds reject publishing and non-Linux-x64 targets', () => {
  expect(() => requireAsterLocalBuildArgs(['--target=linux-x64'])).not.toThrow()
  expect(() =>
    requireAsterLocalBuildArgs(['--target=linux-x64', '--upload']),
  ).toThrow('local-only')
  expect(() => requireAsterLocalBuildArgs(['--target=all'])).toThrow(
    'only --target=linux-x64',
  )
  expect(() =>
    requireAsterLocalBuildArgs(['--target=linux-x64', '--target=darwin-arm64']),
  ).toThrow('exactly one')
  expect(() =>
    requireAsterLocalBuildArgs([
      '--target=linux-x64',
      '--target',
      'darwin-arm64',
    ]),
  ).toThrow('exactly one')
  expect(() =>
    requireAsterLocalBuildArgs([
      '--target',
      'darwin-arm64',
      '--target=linux-x64',
    ]),
  ).toThrow('exactly one')
})
