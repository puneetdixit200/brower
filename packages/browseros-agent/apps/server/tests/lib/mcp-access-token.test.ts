import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadOrCreateMcpAccessToken,
  matchesMcpAccessToken,
} from '../../src/lib/mcp-access-token'

const previousDir = process.env.BROWSEROS_DIR
let tempDir: string | undefined

afterEach(async () => {
  if (previousDir === undefined) delete process.env.BROWSEROS_DIR
  else process.env.BROWSEROS_DIR = previousDir
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe('persistent external MCP credential', () => {
  it('creates an owner-only token and reuses it across server starts', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-mcp-token-'))
    process.env.BROWSEROS_DIR = tempDir

    const token = await loadOrCreateMcpAccessToken()
    const again = await loadOrCreateMcpAccessToken()
    const path = join(tempDir, 'security', 'mcp-access-token')
    const [dirInfo, fileInfo, contents] = await Promise.all([
      stat(join(tempDir, 'security')),
      stat(path),
      readFile(path, 'utf8'),
    ])

    expect(token).toHaveLength(43)
    expect(again).toBe(token)
    expect(contents.trim()).toBe(token)
    expect(dirInfo.mode & 0o777).toBe(0o700)
    expect(fileInfo.mode & 0o777).toBe(0o600)
  })

  it('compares candidates without accepting absent or different tokens', () => {
    expect(matchesMcpAccessToken('abc', 'abc')).toBe(true)
    expect(matchesMcpAccessToken('abd', 'abc')).toBe(false)
    expect(matchesMcpAccessToken(null, 'abc')).toBe(false)
  })
})
