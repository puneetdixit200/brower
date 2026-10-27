import { expect, test } from 'bun:test'
import { asterServerBuildProduct } from './aster-descriptor'

test('Aster has distinct Linux development artifact identities', () => {
  expect(asterServerBuildProduct.entrypoint).toBe(
    'apps/server/src/compiled-bootstrap.ts',
  )
  expect(asterServerBuildProduct.distRoot).toBe('dist/prod/aster-server')
  expect(asterServerBuildProduct.rawBinaryBaseName).toBe('aster-server')
  expect(asterServerBuildProduct.stagedBinaryBaseName).toBe('aster_server')
  expect(asterServerBuildProduct.archiveBaseName).toBe('aster-server-resources')
  expect(asterServerBuildProduct.defaultUpload).toBe(false)
})

test('Aster does not inline BrowserOS telemetry defaults or keys', () => {
  expect(asterServerBuildProduct.env.requiredInlineEnvKeys).toEqual([])
  expect(asterServerBuildProduct.env.inlineEnvKeys).not.toContain(
    'POSTHOG_API_KEY',
  )
  expect(asterServerBuildProduct.env.inlineEnvKeys).not.toContain('SENTRY_DSN')
  expect(asterServerBuildProduct.env.ciInlineEnvDefaults).toBeUndefined()
  expect(asterServerBuildProduct.env.ciInlineEnvOverrides).toBeUndefined()
  expect(
    asterServerBuildProduct.env.inlineEnvOverrides?.ASTER_SERVER_BUILD,
  ).toBe('aster')
})
