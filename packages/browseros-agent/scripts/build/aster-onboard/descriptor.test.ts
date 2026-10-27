import { describe, expect, it } from 'bun:test'
import { asterOnboardBuildProduct } from './descriptor'

describe('Aster onboarding build descriptor', () => {
  it('builds an Aster branded local resource archive without default upload', () => {
    expect(asterOnboardBuildProduct.buildCommand).toEqual([
      'bun',
      'run',
      'build:aster-chromium',
    ])
    expect(asterOnboardBuildProduct.assetsDir).toBe(
      'apps/app-onboard/dist/chromium',
    )
    expect(asterOnboardBuildProduct.distRoot).toBe('dist/local/aster-onboard')
    expect(asterOnboardBuildProduct.archiveBaseName).toBe(
      'aster-onboard-resources',
    )
    expect(asterOnboardBuildProduct.defaultUpload).toBe(false)
    expect(asterOnboardBuildProduct.env.defaultR2UploadPrefix).toBeUndefined()
  })
})
