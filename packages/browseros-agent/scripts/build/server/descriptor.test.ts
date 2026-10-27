import { expect, test } from 'bun:test'
import { browserosServerBuildProduct } from './descriptor'

test('server telemetry keys are optional for production builds', () => {
  expect(browserosServerBuildProduct.env.requiredInlineEnvKeys).toEqual([])
  expect(browserosServerBuildProduct.env.inlineEnvKeys).toContain(
    'POSTHOG_API_KEY',
  )
  expect(browserosServerBuildProduct.env.inlineEnvKeys).toContain('SENTRY_DSN')
})

test('BrowserOS builds cannot inherit the Aster server marker from the host', () => {
  expect(browserosServerBuildProduct.env.inlineEnvKeys).toContain(
    'ASTER_SERVER_BUILD',
  )
  expect(browserosServerBuildProduct.env.inlineEnvOverrides).toEqual({
    ASTER_SERVER_BUILD: '',
  })
})
