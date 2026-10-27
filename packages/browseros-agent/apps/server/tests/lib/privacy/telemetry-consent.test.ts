/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, describe, expect, it } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostHogTransportLease } from '../../../src/lib/privacy/posthog-transport'
import {
  initializeTelemetryConsent,
  isTelemetryEnabled,
  readTelemetryConsent,
  resetTelemetryConsentForTesting,
  setTelemetryConsent,
  TELEMETRY_CONSENT_FILE,
  TelemetryConsentStore,
} from '../../../src/lib/privacy/telemetry-consent'

const temporaryDirectories: string[] = []

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'browseros-telemetry-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  resetTelemetryConsentForTesting()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('TelemetryConsentStore', () => {
  it('defaults off when no consent file exists and persists the explicit choice privately', async () => {
    const directory = await makeDirectory()
    const first = new TelemetryConsentStore(directory)

    expect(first.isEnabled()).toBe(false)
    const initial = await first.load()
    expect(initial.enabled).toBe(false)
    expect(initial.revision).toMatch(/^[0-9a-f-]{36}$/i)
    const granted = await first.set(true)
    expect(granted.enabled).toBe(true)
    expect(granted.revision).not.toBe(initial.revision)
    expect(first.isEnabled()).toBe(true)
    const renewed = await first.set(true)
    expect(renewed.revision).not.toBe(granted.revision)

    const info = await stat(join(directory, TELEMETRY_CONSENT_FILE))
    expect(info.mode & 0o777).toBe(0o600)
    const persisted = JSON.parse(
      await readFile(join(directory, TELEMETRY_CONSENT_FILE), 'utf8'),
    ) as { enabled: boolean; revision: string }
    expect(persisted.enabled).toBe(true)
    expect(persisted.revision).toBe(renewed.revision)
  })

  it('loads consent from the actual state directory after server restart', async () => {
    const directory = await makeDirectory()
    await new TelemetryConsentStore(directory).set(true)

    const restarted = new TelemetryConsentStore(directory)
    expect(restarted.isEnabled()).toBe(false)
    expect((await restarted.load()).enabled).toBe(true)
    expect(restarted.isEnabled()).toBe(true)

    await restarted.set(false)
    expect((await new TelemetryConsentStore(directory).load()).enabled).toBe(
      false,
    )
  })

  it('changes revision on each transition and observes another context revoke', async () => {
    const directory = await makeDirectory()
    const serverA = new TelemetryConsentStore(directory)
    const serverB = new TelemetryConsentStore(directory)
    await serverA.load()
    await serverB.load()

    const grant = await serverA.set(true)
    expect((await serverB.reload()).enabled).toBe(true)
    expect((await serverB.reload()).revision).toBe(grant.revision)

    const revoke = await serverB.set(false)
    const observedRevoke = await serverA.reload()
    expect(observedRevoke.enabled).toBe(false)
    expect(observedRevoke.revision).toBe(revoke.revision)
    expect(revoke.revision).not.toBe(grant.revision)

    const regrant = await serverB.set(true)
    expect(regrant.revision).not.toBe(revoke.revision)
  })

  it('rejects a grant read from an inode replaced by another consent writer', async () => {
    const directory = await makeDirectory()
    const storeA = new TelemetryConsentStore(directory)
    const storeB = new TelemetryConsentStore(directory)
    await storeA.load()
    const grant = await storeA.set(true)
    const prototypeHandle = await open(join(directory, TELEMETRY_CONSENT_FILE))
    const handlePrototype = Object.getPrototypeOf(prototypeHandle) as {
      readFile: typeof prototypeHandle.readFile
    }
    const realReadFile = handlePrototype.readFile
    await prototypeHandle.close()
    let readComplete!: () => void
    let releaseRead!: () => void
    const readBarrier = new Promise<void>((resolve) => {
      readComplete = resolve
    })
    const releaseBarrier = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    handlePrototype.readFile = async function (
      ...args: Parameters<typeof realReadFile>
    ) {
      const bytes = await realReadFile.apply(this, args)
      if (typeof bytes === 'string' && bytes.includes(grant.revision)) {
        readComplete()
        await releaseBarrier
      }
      return bytes
    }

    try {
      const staleReload = storeA.reload()
      await readBarrier
      const revoked = await storeB.set(false)
      expect(revoked.enabled).toBe(false)
      releaseRead()
      const staleResult = await staleReload
      expect(staleResult.enabled).toBe(false)
      expect(staleResult.revision).not.toBe(grant.revision)

      let dispatched = 0
      const lease = new PostHogTransportLease(
        'https://app.posthog.com',
        async () => {
          dispatched += 1
          return new Response('', { status: 200 })
        },
        async () => {
          const current = await storeA.reload()
          return current.enabled && current.revision === grant.revision
        },
      )
      await lease.fetch('https://app.posthog.com/batch/', {} as never)
      expect(dispatched).toBe(0)
    } finally {
      handlePrototype.readFile = realReadFile
      releaseRead()
    }
  })

  it('rejects a grant when another store replaces the inode while close is pending', async () => {
    const directory = await makeDirectory()
    const storeA = new TelemetryConsentStore(directory)
    const storeB = new TelemetryConsentStore(directory)
    await storeA.load()
    const grant = await storeA.set(true)
    const prototypeHandle = await open(join(directory, TELEMETRY_CONSENT_FILE))
    const handlePrototype = Object.getPrototypeOf(prototypeHandle) as {
      close: typeof prototypeHandle.close
    }
    const realClose = handlePrototype.close
    await prototypeHandle.close()

    let closeComplete!: () => void
    let releaseClose!: () => void
    const closeBarrier = new Promise<void>((resolve) => {
      closeComplete = resolve
    })
    const releaseBarrier = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    let closeCount = 0
    handlePrototype.close = async function (
      ...args: Parameters<typeof realClose>
    ) {
      const result = await realClose.apply(this, args)
      closeCount += 1
      if (closeCount === 1) {
        closeComplete()
        await releaseBarrier
      }
      return result
    }

    try {
      const staleReload = storeA.reload()
      await closeBarrier
      const revoked = await storeB.set(false)
      expect(revoked.enabled).toBe(false)
      releaseClose()
      const staleResult = await staleReload
      expect(staleResult.enabled).toBe(false)
      expect(staleResult.revision).not.toBe(grant.revision)

      let dispatched = 0
      const lease = new PostHogTransportLease(
        'https://app.posthog.com',
        async () => {
          dispatched += 1
          return new Response('', { status: 200 })
        },
        async () => {
          const current = await storeA.reload()
          return current.enabled && current.revision === grant.revision
        },
      )
      await lease.fetch('https://app.posthog.com/batch/', {} as never)
      expect(dispatched).toBe(0)
    } finally {
      handlePrototype.close = realClose
      releaseClose()
    }
  })

  it('keeps the process gate off until the resolved directory has loaded', async () => {
    const directory = await makeDirectory()
    await new TelemetryConsentStore(directory).set(true)

    resetTelemetryConsentForTesting()
    expect(isTelemetryEnabled()).toBe(false)
    expect(readTelemetryConsent().enabled).toBe(false)
    expect((await initializeTelemetryConsent(directory)).enabled).toBe(true)
    expect(isTelemetryEnabled()).toBe(true)
    expect((await setTelemetryConsent(false)).enabled).toBe(false)
    expect(isTelemetryEnabled()).toBe(false)
  })

  it('fails closed for malformed or unexpected consent data', async () => {
    const directory = await makeDirectory()
    const file = join(directory, TELEMETRY_CONSENT_FILE)
    const store = new TelemetryConsentStore(directory)
    await store.set(true)

    await writeFile(file, '{"enabled":"yes"}')
    expect((await store.load()).enabled).toBe(false)
    expect(store.isEnabled()).toBe(false)

    await writeFile(
      file,
      '{"enabled":true,"revision":"00000000-0000-4000-8000-000000000001","future":true}',
      { mode: 0o600 },
    )
    expect((await store.load()).enabled).toBe(false)
  })

  it('fails closed when the consent file is not private', async () => {
    const directory = await makeDirectory()
    const file = join(directory, TELEMETRY_CONSENT_FILE)
    await writeFile(
      file,
      '{"enabled":true,"revision":"00000000-0000-4000-8000-000000000001"}\n',
      { mode: 0o644 },
    )

    const store = new TelemetryConsentStore(directory)
    expect((await store.load()).enabled).toBe(false)
    expect(store.isEnabled()).toBe(false)
  })

  it('fails closed for symlinked consent files and noncanonical state directories', async () => {
    const directory = await makeDirectory()
    const outside = join(directory, 'outside.json')
    await writeFile(
      outside,
      '{"enabled":true,"revision":"00000000-0000-4000-8000-000000000001"}\n',
      { mode: 0o600 },
    )
    await symlink(outside, join(directory, TELEMETRY_CONSENT_FILE))

    const store = new TelemetryConsentStore(directory)
    expect((await store.load()).enabled).toBe(false)

    const link = join(directory, 'state-link')
    const real = join(directory, 'real-state')
    await mkdir(real, { mode: 0o700 })
    await symlink(real, link)
    expect((await new TelemetryConsentStore(link).load()).enabled).toBe(false)
  })

  it('clears an in-memory grant if persistence fails', async () => {
    const directory = await makeDirectory()
    const store = new TelemetryConsentStore(directory)
    await store.set(true)

    // Replacing the directory with a symlink makes future persistence unsafe.
    const moved = join(directory, 'moved')
    const state = join(directory, 'state')
    await mkdir(state, { mode: 0o700 })
    const unsafeStore = new TelemetryConsentStore(state)
    await unsafeStore.set(true)
    expect(unsafeStore.isEnabled()).toBe(true)
    await rm(state, { recursive: true })
    await symlink(moved, state)

    await expect(unsafeStore.set(false)).rejects.toThrow()
    expect(unsafeStore.isEnabled()).toBe(false)
    expect((await unsafeStore.reload()).enabled).toBe(false)
  })
})
