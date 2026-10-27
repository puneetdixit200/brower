import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromeExtensionId } from './aster-manifest-identity'

const appRoot = resolve(import.meta.dir, '../..')
const wxtBin = resolve(appRoot, 'node_modules/.bin/wxt')
// biome-ignore lint/style/noProcessEnv: opt-in full build integration gate
const integrationEnabled = process.env.ASTER_RUN_MANIFEST_INTEGRATION === '1'
let tempRoot: string
let configPath: string
let manifestPath: string

function cleanBuildEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  // biome-ignore lint/style/noProcessEnv: subprocess needs an isolated build environment
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('ASTER_') || name === 'SENTRY_AUTH_TOKEN') {
      delete env[name]
    }
  }
  env.JITI_FS_CACHE = 'false'
  env.NODE_OPTIONS ||= '--max-old-space-size=4096'
  Object.assign(env, overrides)
  return env
}

function build(overrides: Record<string, string | undefined> = {}) {
  return spawnSync(
    process.execPath,
    [wxtBin, 'build', '--mode', 'development', '--config', configPath],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: cleanBuildEnv(overrides),
      timeout: 5 * 60 * 1000,
    },
  )
}

describe.skipIf(!integrationEnabled)(
  'emitted Aster development manifest',
  () => {
    beforeAll(
      () => {
        tempRoot = mkdtempSync(join(tmpdir(), 'aster-manifest-build-'))
        configPath = join(tempRoot, 'wxt.config.mjs')
        manifestPath = join(tempRoot, 'chrome-mv3-dev', 'manifest.json')
        const sourceConfigUrl = new URL('../../wxt.config.ts', import.meta.url)
          .href
        writeFileSync(
          configPath,
          `import config from ${JSON.stringify(sourceConfigUrl)};\nexport default { ...config, outDir: ${JSON.stringify(tempRoot)} };\n`,
        )
        const result = build()
        if (result.error) throw result.error
        if (result.status !== 0) {
          throw new Error(
            `WXT development build failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
          )
        }
      },
      5 * 60 * 1000,
    )

    afterAll(() => {
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
    })

    test('contains the stable Aster ID and keeps updater and cross-origin access closed by default', () => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        key?: string
        update_url?: string
        externally_connectable?: { ids?: string[] }
        web_accessible_resources?: unknown
      }

      expect(manifest.key).toBeDefined()
      expect(chromeExtensionId(manifest.key ?? '')).toBe(
        'oifdmombnijnaiocijiacjhajbnpdlhb',
      )
      expect(manifest.update_url).toBeUndefined()
      expect(manifest.externally_connectable).toEqual({ ids: [] })
      expect(manifest.web_accessible_resources).toBeUndefined()
    })

    test('WXT rejects an incomplete release identity configuration', () => {
      const result = build({
        ASTER_EXTENSION_PUBLIC_KEY:
          'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA',
      })

      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'ASTER_EXTENSION_PUBLIC_KEY and ASTER_EXTENSION_UPDATE_URL must be set together',
      )
    })
  },
)
