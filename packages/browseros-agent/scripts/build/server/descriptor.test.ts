import { expect, test } from 'bun:test'
import { browserosServerBuildProduct } from './descriptor'

test('server telemetry keys are optional for production builds', () => {
  expect(browserosServerBuildProduct.env.requiredInlineEnvKeys).toEqual([])
  expect(browserosServerBuildProduct.env.inlineEnvKeys).toContain(
    'POSTHOG_API_KEY',
  )
  expect(browserosServerBuildProduct.env.inlineEnvKeys).toContain('SENTRY_DSN')
})
