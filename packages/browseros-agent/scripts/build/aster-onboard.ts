#!/usr/bin/env bun

import { runProdAssetBuild } from '@browseros/build-server-tools'

import { asterOnboardBuildProduct } from './aster-onboard/descriptor'

runProdAssetBuild(asterOnboardBuildProduct, process.argv.slice(2)).catch(
  (error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n✗ ${message}\n`)
    process.exit(1)
  },
)
