#!/usr/bin/env bun

import { fileURLToPath } from 'node:url'

import { runProdResourceBuild } from '@browseros/build-server-tools'

import { asterServerBuildProduct } from './server/aster-descriptor'
import {
  requireAsterLocalBuildArgs,
  stageAsterBunRuntime,
} from './server/aster-runtime'

const args = process.argv.slice(2)
const agentRoot = fileURLToPath(new URL('../..', import.meta.url))

Promise.resolve()
  .then(() => {
    requireAsterLocalBuildArgs(args)
    return stageAsterBunRuntime(agentRoot)
  })
  .then(() => runProdResourceBuild(asterServerBuildProduct, args))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n✗ ${message}\n`)
    process.exit(1)
  })
