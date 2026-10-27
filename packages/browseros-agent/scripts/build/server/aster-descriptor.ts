import {
  type BuildProductDescriptor,
  wasmBinaryPlugin,
} from '@browseros/build-server-tools'

export const ASTER_SERVER_BUNDLE_ENTRYPOINT =
  'apps/server/src/compiled-bootstrap.ts'

// This development artifact uses the shared server bootstrap and local
// migrations only. No BrowserOS CI telemetry defaults or production feeds.
export const asterServerBuildProduct: BuildProductDescriptor = {
  label: 'Aster development server',
  packageDir: 'apps/server',
  entrypoint: ASTER_SERVER_BUNDLE_ENTRYPOINT,
  distRoot: 'dist/prod/aster-server',
  rawBinaryBaseName: 'aster-server',
  stagedBinaryBaseName: 'aster_server',
  archiveBaseName: 'aster-server-resources',
  defaultManifestPath: 'scripts/build/config/aster-server-resources.json',
  expectedArtifactFiles: () => [
    'resources/bin/aster_server',
    'resources/bin/third_party/bun',
    'resources/bin/third_party/bun.provenance.json',
  ],
  defaultUpload: false,
  env: {
    requiredInlineEnvKeys: [],
    inlineEnvKeys: ['NODE_ENV', 'LOG_LEVEL', 'ASTER_SERVER_BUILD'],
    inlineEnvOverrides: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      ASTER_SERVER_BUILD: 'aster',
    },
    defaultR2UploadPrefix: 'artifacts/aster-server',
  },
  bundle: {
    external: ['node-pty'],
    plugins: [wasmBinaryPlugin()],
  },
}
