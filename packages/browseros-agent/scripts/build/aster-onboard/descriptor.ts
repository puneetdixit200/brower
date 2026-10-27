import type { AssetBuildProductDescriptor } from '@browseros/build-server-tools'

// Aster onboarding is a local working-tree resource. It deliberately has no
// default R2 destination and cannot become part of a production feed by default.
export const asterOnboardBuildProduct: AssetBuildProductDescriptor = {
  label: 'Aster onboarding',
  packageDir: 'apps/app-onboard',
  buildCommand: ['bun', 'run', 'build:aster-chromium'],
  assetsDir: 'apps/app-onboard/dist/chromium',
  distRoot: 'dist/local/aster-onboard',
  archiveBaseName: 'aster-onboard-resources',
  defaultUpload: false,
  env: {
    requiredInlineEnvKeys: [],
    inlineEnvKeys: ['NODE_ENV'],
    ciInlineEnvDefaults: { NODE_ENV: 'production' },
    inlineEnvOverrides: { NODE_ENV: 'production' },
  },
}
