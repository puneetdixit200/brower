import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

export const ASTER_BUN_VERSION = '1.4.2'
export const ASTER_BUN_RELATIVE_PATH = 'resources/bin/third_party/bun'
export const ASTER_BUN_PROVENANCE_RELATIVE_PATH =
  'resources/bin/third_party/bun.provenance.json'

interface RuntimeHost {
  platform: string
  arch: string
}

export interface AsterBunProvenance {
  schemaVersion: 1
  version: string
  platform: 'linux'
  arch: 'x64'
  sha256: string
}

async function sha256(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

function requireLinuxX64Elf(path: string): void {
  const header = Buffer.alloc(20)
  const fd = openSync(path, 'r')
  // Read only the ELF identification and machine fields; do not load or run
  // the file until its real Bun version has also been checked.
  try {
    readSync(fd, header, 0, header.length, 0)
  } finally {
    closeSync(fd)
  }
  if (
    header[0] !== 0x7f ||
    header.toString('ascii', 1, 4) !== 'ELF' ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header.readUInt16LE(18) !== 62
  ) {
    throw new Error(
      `Aster Bun runtime is not a Linux x64 ELF executable: ${path}`,
    )
  }
}

function pinnedPackageBunVersion(agentRoot: string): string {
  const packageJson = JSON.parse(
    readFileSync(join(agentRoot, 'package.json'), 'utf8'),
  ) as { engines?: { bun?: unknown } }
  if (packageJson.engines?.bun !== ASTER_BUN_VERSION) {
    throw new Error(
      `Aster server requires package engines.bun=${ASTER_BUN_VERSION}`,
    )
  }
  return packageJson.engines.bun
}

export async function stageAsterBunRuntime(
  agentRoot: string,
  executablePath = process.execPath,
  host: RuntimeHost = { platform: process.platform, arch: process.arch },
): Promise<AsterBunProvenance> {
  if (host.platform !== 'linux' || host.arch !== 'x64') {
    throw new Error('Aster server resource builds require a Linux x64 Bun host')
  }
  const expectedVersion = pinnedPackageBunVersion(agentRoot)
  const source = realpathSync(executablePath)
  if (!statSync(source).isFile()) {
    throw new Error(`Aster Bun runtime is not a regular file: ${source}`)
  }
  requireLinuxX64Elf(source)
  const actualVersion = execFileSync(source, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim()
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Aster Bun runtime version ${actualVersion} does not match pinned ${expectedVersion}`,
    )
  }

  const inputDir = resolve(agentRoot, 'dist/prod/aster-server/.inputs')
  try {
    const inputStat = lstatSync(inputDir)
    if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) {
      throw new Error(
        `Aster Bun cache path must be an owned directory: ${inputDir}`,
      )
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    mkdirSync(inputDir, { recursive: true })
  }
  const runtimePath = join(inputDir, 'bun')
  const provenancePath = join(inputDir, 'bun-provenance.json')
  // Remove only files in this Aster-owned ignored build cache. Never write to
  // the builder's executable or another product's shared runtime cache.
  for (const path of [runtimePath, provenancePath]) {
    try {
      if (lstatSync(path).isDirectory()) {
        throw new Error(`Aster Bun cache path must be a file: ${path}`)
      }
      rmSync(path, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  copyFileSync(source, runtimePath)
  chmodSync(runtimePath, 0o755)
  const provenance: AsterBunProvenance = {
    schemaVersion: 1,
    version: actualVersion,
    platform: 'linux',
    arch: 'x64',
    sha256: await sha256(runtimePath),
  }
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)
  return provenance
}

export function requireAsterLocalBuildArgs(args: readonly string[]): void {
  if (args.includes('--upload') || args.includes('--versioned-only')) {
    throw new Error(
      'Aster server builds are local-only until release provisioning',
    )
  }
  const targets: Array<string | undefined> = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--target') {
      const value = args[index + 1]
      targets.push(value && !value.startsWith('--') ? value : undefined)
      if (value && !value.startsWith('--')) index += 1
    } else if (argument.startsWith('--target=')) {
      targets.push(argument.slice('--target='.length))
    }
  }
  if (targets.length !== 1) {
    throw new Error(
      'Aster server builds require exactly one --target=linux-x64',
    )
  }
  if (targets[0] !== 'linux-x64') {
    throw new Error(
      'Aster server builds currently support only --target=linux-x64',
    )
  }
}
