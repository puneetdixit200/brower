/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { rmSync } from 'node:fs'
import {
  createTestRuntimePlan,
  type TestRuntimePlan,
} from './__helpers__/test-runtime'

const originalHeadless = process.env.BROWSEROS_TEST_HEADLESS
const originalAsterBinary = process.env.ASTER_BROWSER_BINARY
const originalAsterBin = process.env.ASTER_BROWSER_BIN
const originalBrowserOsBinary = process.env.BROWSEROS_BINARY
const runtimePlans: TestRuntimePlan[] = []

afterEach(() => {
  if (originalHeadless === undefined) {
    delete process.env.BROWSEROS_TEST_HEADLESS
  } else {
    process.env.BROWSEROS_TEST_HEADLESS = originalHeadless
  }

  if (originalAsterBinary === undefined) {
    delete process.env.ASTER_BROWSER_BINARY
  } else {
    process.env.ASTER_BROWSER_BINARY = originalAsterBinary
  }
  if (originalAsterBin === undefined) {
    delete process.env.ASTER_BROWSER_BIN
  } else {
    process.env.ASTER_BROWSER_BIN = originalAsterBin
  }
  if (originalBrowserOsBinary === undefined) {
    delete process.env.BROWSEROS_BINARY
  } else {
    process.env.BROWSEROS_BINARY = originalBrowserOsBinary
  }

  for (const plan of runtimePlans) {
    rmSync(plan.userDataDir, { recursive: true, force: true })
  }
  runtimePlans.length = 0
})

async function resolveHeadless(value: string | undefined): Promise<boolean> {
  if (value === undefined) {
    delete process.env.BROWSEROS_TEST_HEADLESS
  } else {
    process.env.BROWSEROS_TEST_HEADLESS = value
  }

  const plan = await createTestRuntimePlan()
  runtimePlans.push(plan)
  return plan.headless
}

describe('createTestRuntimePlan headless mode', () => {
  it('defaults to headless when the flag is absent', async () => {
    expect(await resolveHeadless(undefined)).toBe(true)
  })

  it('uses headless mode when the flag is true', async () => {
    expect(await resolveHeadless('true')).toBe(true)
  })

  it('uses headed mode when the flag is false', async () => {
    expect(await resolveHeadless('false')).toBe(false)
  })
})

describe('createTestRuntimePlan browser binary', () => {
  it('prefers the documented ASTER_BROWSER_BIN override', async () => {
    process.env.ASTER_BROWSER_BIN = '/opt/aster/browseros.AppImage'
    process.env.ASTER_BROWSER_BINARY = '/opt/older-aster/browseros.AppImage'

    const plan = await createTestRuntimePlan()
    runtimePlans.push(plan)
    expect(plan.binaryPath).toBe('/opt/aster/browseros.AppImage')
  })

  it('prefers the Aster Linux binary override', async () => {
    process.env.ASTER_BROWSER_BINARY = '/opt/aster/browseros.AppImage'
    process.env.BROWSEROS_BINARY = '/usr/bin/browseros'

    const plan = await createTestRuntimePlan()
    runtimePlans.push(plan)
    expect(plan.binaryPath).toBe('/opt/aster/browseros.AppImage')
  })

  it('uses the BrowserOS binary override when the Aster override is absent', async () => {
    delete process.env.ASTER_BROWSER_BINARY
    process.env.BROWSEROS_BINARY = '/opt/browseros.AppImage'

    const plan = await createTestRuntimePlan()
    runtimePlans.push(plan)
    expect(plan.binaryPath).toBe('/opt/browseros.AppImage')
  })

  it('uses a Linux PATH command when no override is configured', async () => {
    if (process.platform !== 'linux') return
    delete process.env.ASTER_BROWSER_BINARY
    delete process.env.BROWSEROS_BINARY

    const plan = await createTestRuntimePlan()
    runtimePlans.push(plan)
    expect(plan.binaryPath).toBe('browseros')
  })
})
