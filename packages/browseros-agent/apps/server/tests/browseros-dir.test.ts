/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import {
  ensureBrowserosDir,
  getBrowserosDir,
  getCacheDir,
  getDbPath,
  getSessionsDir,
  getToolOutputDir,
  logDevelopmentBrowserosDir,
  TOOL_OUTPUT_DIR_MODE,
  writeToolOutputFile,
} from '../src/lib/browseros-dir'
import { logger } from '../src/lib/logger'

function getBrowserosDirInIsolatedProcess(
  environment: Record<string, string | undefined>,
): string {
  const moduleUrl = new URL('../src/lib/browseros-dir.ts', import.meta.url).href
  const source = `
    const { getBrowserosDir } = await import(${JSON.stringify(moduleUrl)});
    console.log(getBrowserosDir());
  `
  const childEnv: Record<string, string> = { ...process.env }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnv[key]
    else childEnv[key] = value
  }
  const result = spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    env: childEnv,
    cwd: join(import.meta.dir, '../../..'),
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || `Child process exited ${result.status}`)
  }
  return result.stdout.trim()
}

function writeBrowserOutputInIsolatedProcess(
  environment: Record<string, string | undefined>,
): { stateDir: string; outputDir: string; filePath: string; contents: string } {
  const serverModuleUrl = new URL(
    '../src/lib/browseros-dir.ts',
    import.meta.url,
  ).href
  const browserOutputModuleUrl = new URL(
    '../../../packages/browser-mcp/src/tools/output-file.ts',
    import.meta.url,
  ).href
  const source = `
    import { readFile } from 'node:fs/promises';
    const { getBrowserosDir, getToolOutputDir } = await import(${JSON.stringify(serverModuleUrl)});
    const { writeTempToolOutputFile } = await import(${JSON.stringify(browserOutputModuleUrl)});
    const filePath = await writeTempToolOutputFile({
      toolName: 'aster-isolation', extension: 'txt', content: 'shared-state-root',
    });
    console.log(JSON.stringify({
      stateDir: getBrowserosDir(),
      outputDir: await getToolOutputDir(),
      filePath,
      contents: await readFile(filePath, 'utf8'),
    }));
  `
  const childEnv: Record<string, string> = { ...process.env }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnv[key]
    else childEnv[key] = value
  }
  const result = spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    env: childEnv,
    cwd: join(import.meta.dir, '../../..'),
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || `Child process exited ${result.status}`)
  }
  return JSON.parse(result.stdout.trim()) as {
    stateDir: string
    outputDir: string
    filePath: string
    contents: string
  }
}

describe('getBrowserosDir', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalBrowserosDir = process.env.BROWSEROS_DIR

  beforeEach(() => {
    delete process.env.NODE_ENV
    delete process.env.BROWSEROS_DIR
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }

    if (originalBrowserosDir === undefined) {
      delete process.env.BROWSEROS_DIR
    } else {
      process.env.BROWSEROS_DIR = originalBrowserosDir
    }
  })

  it('uses a separate home directory in development', () => {
    process.env.NODE_ENV = 'development'

    expect(getBrowserosDir()).toBe(join(homedir(), '.browseros-dev'))
  })

  it('uses Aster-owned home state for a baked Aster server', () => {
    const home = mkdtempSync(join(tmpdir(), 'aster-home-test-'))

    try {
      expect(
        getBrowserosDirInIsolatedProcess({
          HOME: home,
          NODE_ENV: 'production',
          ASTER_SERVER_BUILD: 'aster',
          BROWSEROS_DIR: '/wrong-browseros',
          ASTER_DIR: undefined,
        }),
      ).toBe(join(home, '.aster'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses the Aster override for a baked Aster server', () => {
    const home = mkdtempSync(join(tmpdir(), 'aster-home-test-'))

    try {
      expect(
        getBrowserosDirInIsolatedProcess({
          HOME: home,
          NODE_ENV: 'production',
          ASTER_SERVER_BUILD: 'aster',
          ASTER_DIR: '/tmp/aster-state',
          BROWSEROS_DIR: '/wrong-browseros',
        }),
      ).toBe('/tmp/aster-state')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses the Aster development directory for a baked development server', () => {
    const home = mkdtempSync(join(tmpdir(), 'aster-home-test-'))

    try {
      expect(
        getBrowserosDirInIsolatedProcess({
          HOME: home,
          NODE_ENV: 'development',
          ASTER_SERVER_BUILD: 'aster',
          ASTER_DIR: undefined,
          BROWSEROS_DIR: '/wrong-browseros',
        }),
      ).toBe(join(home, '.aster-dev'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('ignores ASTER markers and overrides for an ordinary BrowserOS server', () => {
    const home = mkdtempSync(join(tmpdir(), 'browseros-home-test-'))

    try {
      expect(
        getBrowserosDirInIsolatedProcess({
          HOME: home,
          NODE_ENV: 'production',
          ASTER_SERVER_BUILD: '',
          ASTER_DIR: '/wrong-aster',
          BROWSEROS_DIR: '/tmp/browseros-state',
        }),
      ).toBe('/tmp/browseros-state')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('writes MCP output where the server can read it in a baked Aster build', () => {
    const home = mkdtempSync(join(tmpdir(), 'aster-output-home-test-'))

    try {
      const output = writeBrowserOutputInIsolatedProcess({
        HOME: home,
        NODE_ENV: 'production',
        ASTER_SERVER_BUILD: 'aster',
        ASTER_DIR: undefined,
        BROWSEROS_DIR: '/wrong-browseros',
      })
      const asterOutputDir = join(home, '.aster', 'tool-output')

      expect(output.stateDir).toBe(join(home, '.aster'))
      expect(output.outputDir).toBe(asterOutputDir)
      expect(output.filePath.startsWith(`${asterOutputDir}/`)).toBe(true)
      expect(output.contents).toBe('shared-state-root')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses the standard home directory outside development', () => {
    process.env.NODE_ENV = 'test'

    expect(getBrowserosDir()).toBe(join(homedir(), PATHS.BROWSEROS_DIR_NAME))
  })

  it('logs the resolved development directory path', () => {
    process.env.NODE_ENV = 'development'
    const originalInfo = logger.info
    const info = mock(() => {})
    logger.info = info

    try {
      logDevelopmentBrowserosDir()

      expect(info).toHaveBeenCalledWith(
        `Using development BrowserOS directory: ${join(homedir(), '.browseros-dev')}`,
      )
    } finally {
      logger.info = originalInfo
    }
  })

  it('does not log a development directory outside development', () => {
    process.env.NODE_ENV = 'test'
    const originalInfo = logger.info
    const info = mock(() => {})
    logger.info = info

    try {
      logDevelopmentBrowserosDir()

      expect(info).not.toHaveBeenCalled()
    } finally {
      logger.info = originalInfo
    }
  })

  it('uses the development cache directory in development', () => {
    process.env.NODE_ENV = 'development'

    expect(getCacheDir()).toBe(join(homedir(), '.browseros-dev', 'cache'))
  })

  it('uses the BrowserOS directory for the sqlite database', () => {
    process.env.NODE_ENV = 'development'

    expect(getDbPath()).toBe(
      join(
        homedir(),
        PATHS.DEV_BROWSEROS_DIR_NAME,
        PATHS.DB_DIR_NAME,
        PATHS.DB_FILE_NAME,
      ),
    )
  })

  it('uses the standard BrowserOS directory for the sqlite database outside development', () => {
    process.env.NODE_ENV = 'test'

    expect(getDbPath()).toBe(
      join(
        homedir(),
        PATHS.BROWSEROS_DIR_NAME,
        PATHS.DB_DIR_NAME,
        PATHS.DB_FILE_NAME,
      ),
    )
  })

  it('uses the standard cache directory outside development', () => {
    process.env.NODE_ENV = 'test'

    expect(getCacheDir()).toBe(
      join(homedir(), PATHS.BROWSEROS_DIR_NAME, 'cache'),
    )
  })
  it('creates only the startup-owned directories during startup setup', async () => {
    const browserosDir = mkdtempSync(join(tmpdir(), 'browseros-dir-test-'))
    process.env.BROWSEROS_DIR = browserosDir

    try {
      await ensureBrowserosDir()

      expect(existsSync(getSessionsDir())).toBe(true)
      expect(existsSync(join(browserosDir, 'tool-output'))).toBe(true)
      expect(existsSync(join(browserosDir, 'cache', 'vm'))).toBe(false)
      expect(existsSync(join(browserosDir, 'vm'))).toBe(false)
      expect(existsSync(join(browserosDir, 'lazy-monitoring'))).toBe(false)
      expect(existsSync(join(browserosDir, 'lazy-monitoring', 'runs'))).toBe(
        false,
      )
    } finally {
      rmSync(browserosDir, { recursive: true, force: true })
    }
  })

  it('locks down the tool output directory permissions', async () => {
    const browserosDir = mkdtempSync(join(tmpdir(), 'browseros-dir-test-'))
    process.env.BROWSEROS_DIR = browserosDir

    try {
      const rawOutputDir = join(browserosDir, 'tool-output')
      const createdOutputDir = await getToolOutputDir()
      expect(createdOutputDir).toBe(realpathSync(rawOutputDir))
      if (process.platform !== 'win32') {
        chmodSync(rawOutputDir, 0o777)
      }

      const outputDir = await getToolOutputDir()

      expect(outputDir).toBe(realpathSync(rawOutputDir))
      if (process.platform !== 'win32') {
        expect(statSync(outputDir).mode & 0o777).toBe(TOOL_OUTPUT_DIR_MODE)
      }
    } finally {
      rmSync(browserosDir, { recursive: true, force: true })
    }
  })

  it('does not overwrite existing generated tool output files', async () => {
    const browserosDir = mkdtempSync(join(tmpdir(), 'browseros-dir-test-'))
    process.env.BROWSEROS_DIR = browserosDir

    try {
      const outputDir = await getToolOutputDir()
      const outputPath = join(outputDir, 'existing.txt')
      writeFileSync(outputPath, 'original')

      await expect(
        writeToolOutputFile(outputPath, 'replacement'),
      ).rejects.toThrow('EEXIST')
    } finally {
      rmSync(browserosDir, { recursive: true, force: true })
    }
  })
})
