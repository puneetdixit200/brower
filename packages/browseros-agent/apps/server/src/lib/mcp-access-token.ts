import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBrowserosDir } from './browseros-dir'

const TOKEN_DIR_MODE = 0o700
const TOKEN_FILE_MODE = 0o600
const TOKEN_FILE_NAME = 'mcp-access-token'

/** Loads the persistent external MCP credential, creating it on first start. */
export async function loadOrCreateMcpAccessToken(): Promise<string> {
  const dir = join(getBrowserosDir(), 'security')
  await mkdir(dir, { recursive: true, mode: TOKEN_DIR_MODE })
  const dirInfo = await lstat(dir)
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) {
    throw new Error('BrowserOS security directory must be a real directory.')
  }
  await chmod(dir, TOKEN_DIR_MODE)

  const path = join(dir, TOKEN_FILE_NAME)
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('BrowserOS MCP access token must be a regular file.')
    }
    await chmod(path, TOKEN_FILE_MODE)
    const token = (await readFile(path, 'utf8')).trim()
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) {
      throw new Error('BrowserOS MCP access token file is invalid.')
    }
    return token
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const token = randomBytes(32).toString('base64url')
  try {
    const file = await open(path, 'wx', TOKEN_FILE_MODE)
    try {
      await file.writeFile(`${token}\n`, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
  } catch (error) {
    // A second server process may have won the creation race. Re-read through
    // the same validation path rather than overwriting its durable credential.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return loadOrCreateMcpAccessToken()
    }
    throw error
  }
  return token
}

export function matchesMcpAccessToken(
  candidate: string | null,
  expected: string,
): boolean {
  if (!candidate) return false
  const expectedBytes = Buffer.from(expected)
  const candidateBytes = Buffer.from(candidate)
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  )
}
