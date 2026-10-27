/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from 'node:crypto'
import {
  type FileHandle,
  constants as fsConstants,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const TELEMETRY_CONSENT_FILE = 'telemetry-consent.json'
export const TELEMETRY_CONSENT_FILE_MODE = 0o600

export type TelemetryConsent = { enabled: boolean; revision: string }

/**
 * Server-owned, fail-closed telemetry consent. A malformed, inaccessible,
 * non-private, or non-regular state file is treated as disabled.
 */
export class TelemetryConsentStore {
  private enabled = false
  private revision: string = randomUUID()
  private operationTail: Promise<void> = Promise.resolve()
  private failedClosed = false
  private readonly directory: string
  private readonly filePath: string

  constructor(stateDirectory: string) {
    this.directory = resolve(stateDirectory)
    this.filePath = join(this.directory, TELEMETRY_CONSENT_FILE)
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getRevision(): string {
    return this.revision
  }

  async load(): Promise<TelemetryConsent> {
    return this.serialize(() => this.loadCanonical())
  }

  private async loadCanonical(): Promise<TelemetryConsent> {
    if (this.failedClosed) {
      this.enabled = false
      return this.snapshot()
    }
    this.enabled = false
    this.revision = randomUUID()

    try {
      await this.validateDirectory()
      const handle = await open(
        this.filePath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      )
      let openedInfo: Awaited<ReturnType<FileHandle['stat']>> | undefined
      let parsedConsent: TelemetryConsent | undefined
      try {
        openedInfo = await handle.stat()
        if (!isPrivateRegularFile(openedInfo)) return this.snapshot()
        const content = await handle.readFile({ encoding: 'utf8' })
        if (content.length > 256) return this.snapshot()
        const parsed: unknown = JSON.parse(content)
        if (!isConsent(parsed)) return this.snapshot()
        parsedConsent = parsed
      } finally {
        // Do not perform a canonical-path check before close: another writer
        // can replace the file while close is pending.
        await handle.close()
      }
      // This is the final awaited operation before publishing. Atomic replace
      // during read OR close means the bytes came from a stale inode.
      const canonicalInfo = await lstat(this.filePath)
      if (
        !openedInfo ||
        !parsedConsent ||
        !isPrivateRegularFile(canonicalInfo) ||
        canonicalInfo.dev !== openedInfo.dev ||
        canonicalInfo.ino !== openedInfo.ino
      ) {
        this.enabled = false
        this.revision = randomUUID()
        return this.snapshot()
      }
      this.enabled = parsedConsent.enabled
      this.revision = parsedConsent.revision
    } catch {
      // Missing, malformed, inaccessible, or unsafe state always means off.
      this.enabled = false
    }

    return this.snapshot()
  }

  async set(enabled: boolean): Promise<TelemetryConsent> {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('Telemetry consent must be a boolean.')
    }

    return this.serialize(() => this.persist(enabled))
  }

  private async persist(enabled: boolean): Promise<TelemetryConsent> {
    try {
      await this.validateDirectory()
      const revision = randomUUID()
      const tempPath = join(
        this.directory,
        `.${basename(this.filePath)}.${randomUUID()}.tmp`,
      )
      let handle: FileHandle | undefined
      try {
        try {
          handle = await open(
            tempPath,
            fsConstants.O_WRONLY |
              fsConstants.O_CREAT |
              fsConstants.O_EXCL |
              (fsConstants.O_NOFOLLOW ?? 0),
            TELEMETRY_CONSENT_FILE_MODE,
          )
          await handle.writeFile(
            `${JSON.stringify({ enabled, revision })}\n`,
            'utf8',
          )
          await handle.sync()
        } finally {
          await handle?.close()
        }
        await rename(tempPath, this.filePath)
      } catch (error) {
        await unlink(tempPath).catch(() => undefined)
        throw error
      }

      const info = await lstat(this.filePath)
      if (!isPrivateRegularFile(info)) {
        this.enabled = false
        this.revision = randomUUID()
        throw new Error('Telemetry consent file permissions are unsafe.')
      }
      this.enabled = enabled
      this.revision = revision
      this.failedClosed = false
      return this.snapshot()
    } catch (error) {
      // A failed write must not leave a previously enabled in-memory grant.
      this.enabled = false
      this.revision = randomUUID()
      this.failedClosed = true
      throw error
    }
  }

  /** Re-read canonical persisted state before authorizing each telemetry send. */
  async reload(): Promise<TelemetryConsent> {
    return this.load()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private snapshot(): TelemetryConsent {
    return { enabled: this.enabled, revision: this.revision }
  }

  private async validateDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const info = await lstat(this.directory)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Telemetry state directory must be a real directory.')
    }
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new Error('Telemetry state directory has a different owner.')
    }
    // Prevent another local user from replacing the consent file between checks.
    if ((info.mode & 0o022) !== 0) {
      throw new Error('Telemetry state directory is writable by other users.')
    }
    const actualPath = await realpath(this.directory)
    if (actualPath !== this.directory) {
      throw new Error('Telemetry state directory path is not canonical.')
    }
  }
}

let activeStore: TelemetryConsentStore | null = null

/** Resolve and load the state directory before any telemetry SDK is started. */
export async function initializeTelemetryConsent(
  stateDirectory: string,
): Promise<TelemetryConsent> {
  const store = new TelemetryConsentStore(stateDirectory)
  activeStore = store
  return store.load()
}

/** Uninitialized state always denies telemetry. */
export function isTelemetryEnabled(): boolean {
  return activeStore?.isEnabled() ?? false
}

export function readTelemetryConsent(): TelemetryConsent {
  return activeStore
    ? { enabled: activeStore.isEnabled(), revision: activeStore.getRevision() }
    : { enabled: false, revision: randomUUID() }
}

/** Reload state for send-time revision checks; any I/O or validation failure denies. */
export async function reloadTelemetryConsent(): Promise<TelemetryConsent> {
  if (!activeStore) return readTelemetryConsent()
  return activeStore.reload()
}

export async function setTelemetryConsent(
  enabled: boolean,
): Promise<TelemetryConsent> {
  if (!activeStore) {
    throw new Error('Telemetry consent state has not been initialized.')
  }
  return activeStore.set(enabled)
}

export function resetTelemetryConsentForTesting(): void {
  activeStore = null
}

function isPrivateRegularFile(
  info: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    info.isFile() &&
    !info.isSymbolicLink() &&
    (Number(info.mode) & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid())
  )
}

function isConsent(value: unknown): value is TelemetryConsent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 2 &&
    typeof record.enabled === 'boolean' &&
    typeof record.revision === 'string' &&
    UUID_PATTERN.test(record.revision)
  )
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
