import {
  type BuildProductDescriptor,
  wasmBinaryPlugin,
} from '@browseros/build-server-tools'

export const SERVER_BUNDLE_ENTRYPOINT = 'apps/server/src/compiled-bootstrap.ts'

// Telemetry is opt-in at runtime; production binaries must build without keys.
const REQUIRED_PROD_VARS: string[] = []
const INLINED_ENV_VARS = [
  'POSTHOG_API_KEY',
  'SENTRY_DSN',
  'NODE_ENV',
  'LOG_LEVEL',
] as const
const CI_INLINE_ENV_DEFAULTS = {
  LOG_LEVEL: 'info',
  NODE_ENV: 'production',
  POSTHOG_API_KEY: 'phc_browseros_ci',
  SENTRY_DSN: 'https://ci@sentry.invalid/1',
}

export const browserosServerBuildProduct: BuildProductDescriptor = {
  label: 'BrowserOS server',
  packageDir: 'apps/server',
  entrypoint: SERVER_BUNDLE_ENTRYPOINT,
  distRoot: 'dist/prod/server',
  rawBinaryBaseName: 'browseros-server',
  stagedBinaryBaseName: 'browseros_server',
  archiveBaseName: 'browseros-server-resources',
  defaultManifestPath: 'scripts/build/config/server-prod-resources.json',
  env: {
    requiredInlineEnvKeys: REQUIRED_PROD_VARS,
    inlineEnvKeys: INLINED_ENV_VARS,
    ciInlineEnvDefaults: CI_INLINE_ENV_DEFAULTS,
    defaultR2UploadPrefix: 'artifacts/server',
    defaultR2DownloadPrefix: 'artifacts/vendor',
  },
  bundle: {
    external: ['node-pty'],
    plugins: [wasmBinaryPlugin()],
  },
}
