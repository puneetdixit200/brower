import { chmod, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getProductStateDir } from '@browseros/shared/utils/browseros-dir'

export const TOOL_OUTPUT_DIR_MODE = 0o700
export const TOOL_OUTPUT_FILE_MODE = 0o600

export function getBrowserosDir(): string {
  // Standalone MCP development honors ASTER_SERVER_BUILD when explicitly set;
  // compiled servers receive its fixed value through Bun's env inlining.
  return getProductStateDir()
}

/** Returns the ready-to-use directory for large generated browser outputs. */
export async function getToolOutputDir(): Promise<string> {
  const outputDirPath = join(getBrowserosDir(), 'tool-output')
  await mkdir(outputDirPath, {
    recursive: true,
    mode: TOOL_OUTPUT_DIR_MODE,
  })
  const info = await lstat(outputDirPath)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('BrowserOS tool output directory must be a real directory.')
  }
  const outputDir = await realpath(outputDirPath)
  await chmod(outputDir, TOOL_OUTPUT_DIR_MODE)
  return outputDir
}

/** Writes a generated browser output file with private owner-only permissions. */
export async function writeToolOutputFile(
  filePath: string,
  content: string,
): Promise<void> {
  await writeFile(filePath, content, {
    encoding: 'utf-8',
    flag: 'wx',
    mode: TOOL_OUTPUT_FILE_MODE,
  })
  await chmod(filePath, TOOL_OUTPUT_FILE_MODE)
}

/** Writes binary browser output with private owner-only permissions. */
export async function writeToolOutputBinaryFile(
  filePath: string,
  content: Uint8Array,
): Promise<void> {
  await writeFile(filePath, content, {
    flag: 'wx',
    mode: TOOL_OUTPUT_FILE_MODE,
  })
  await chmod(filePath, TOOL_OUTPUT_FILE_MODE)
}
