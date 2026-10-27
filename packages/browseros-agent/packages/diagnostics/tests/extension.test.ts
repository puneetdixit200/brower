import { afterEach, describe, expect, it } from 'bun:test'
import { within } from '../src/collector'
import {
  canReadDiagnostics,
  collectBrowserDiagnostics,
  registerDiagnostics,
} from '../src/extension'

const ASTER_REPORTER_ID = 'abcdefghijklmnopabcdefghijklmnop'
const BROWSEROS_REPORTER_ID = 'adlpneommgkgeanpaekgoaolcpncohkf'

const original = globalThis.chrome
afterEach(() => {
  globalThis.chrome = original
})

describe('diagnostics browser boundary', () => {
  it('fails closed externally until an explicit reporter ID is configured', () => {
    expect(canReadDiagnostics({ id: ASTER_REPORTER_ID }, 'app', true)).toBe(
      false,
    )
    expect(
      canReadDiagnostics(
        { id: ASTER_REPORTER_ID },
        'app',
        true,
        ASTER_REPORTER_ID,
      ),
    ).toBe(true)
    expect(
      canReadDiagnostics({ id: 'unknown' }, 'app', true, ASTER_REPORTER_ID),
    ).toBe(false)
    expect(
      canReadDiagnostics(
        { id: BROWSEROS_REPORTER_ID },
        'app',
        true,
        ASTER_REPORTER_ID,
      ),
    ).toBe(false)
    expect(
      canReadDiagnostics({ id: ASTER_REPORTER_ID }, 'app', true, 'invalid-id'),
    ).toBe(false)
    expect(
      canReadDiagnostics({ url: 'https://browseros.com' }, 'app', true),
    ).toBe(false)
    expect(
      canReadDiagnostics(
        { id: 'app', url: 'https://example.com' },
        'app',
        false,
      ),
    ).toBe(false)
    expect(
      canReadDiagnostics(
        { id: 'app', url: 'chrome-extension://app/app.html' },
        'app',
        false,
      ),
    ).toBe(true)
  })
  it('maps both native version functions correctly when the server and Reporter fail', async () => {
    const externalCalls: unknown[][] = []
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: 'extension-version' }),
        getPlatformInfo: async () => ({ os: 'mac', arch: 'arm64' }),
        sendMessage: async (...args: unknown[]) => {
          externalCalls.push(args)
          throw new Error('Reporter missing')
        },
      },
      browserOS: {
        getVersionNumber: (callback: (value: string) => void) =>
          callback('chromium-version'),
        getBrowserosVersionNumber: (callback: (value: string) => void) =>
          callback('browseros-version'),
      },
      system: {
        cpu: {
          getInfo: async () => ({
            modelName: 'Example CPU',
            numOfProcessors: 8,
          }),
        },
        memory: {
          getInfo: async () => ({ capacity: 4096, availableCapacity: 2048 }),
        },
      },
    } as unknown as typeof chrome
    const snapshot = await collectBrowserDiagnostics('browseros', async () => {
      throw new Error('server unavailable')
    })
    expect(snapshot.versions).toEqual({
      browseros: 'browseros-version',
      chromium: 'chromium-version',
      server: null,
      appExtension: 'extension-version',
      reporterExtension: null,
    })
    expect(snapshot.system.os).toBe('macOS')
    expect(snapshot.system.osVersion).toBeNull()
    expect(snapshot.memory.availableBytes).toBe(2048)
    expect(externalCalls).toEqual([])
  })
  it('queries only the explicitly configured reporter for its version', async () => {
    const externalCalls: unknown[][] = []
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: 'extension-version' }),
        getPlatformInfo: async () => ({ os: 'linux', arch: 'x86-64' }),
        sendMessage: async (...args: unknown[]) => {
          externalCalls.push(args)
          return { version: 'reporter-version' }
        },
      },
      system: {
        cpu: { getInfo: async () => ({}) },
        memory: { getInfo: async () => ({}) },
      },
    } as unknown as typeof chrome
    const snapshot = await collectBrowserDiagnostics(
      'browseros',
      async () => {
        throw new Error('server unavailable')
      },
      ASTER_REPORTER_ID,
    )
    expect(externalCalls).toEqual([
      [ASTER_REPORTER_ID, { type: 'browseros:diagnostics:reporter-version' }],
    ])
    expect(snapshot.versions.reporterExtension).toBe('reporter-version')
  })
  it('serves only the diagnostics request to the configured reporter', async () => {
    let externalListener:
      | ((
          request: unknown,
          sender: chrome.runtime.MessageSender,
          respond: (result: unknown) => void,
        ) => boolean | undefined)
      | undefined
    const event = {
      addListener: (listener: typeof externalListener) => {
        externalListener = listener
      },
    }
    globalThis.chrome = {
      runtime: {
        id: 'aster-app',
        onMessage: { addListener: () => {} },
        onMessageExternal: event,
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        getManifest: () => ({ version: 'extension-version' }),
        getPlatformInfo: async () => ({ os: 'linux', arch: 'x86-64' }),
        sendMessage: async () => ({ version: 'reporter-version' }),
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
      system: {
        cpu: { getInfo: async () => ({}) },
        memory: { getInfo: async () => ({}) },
      },
      alarms: {
        create: async () => {},
        onAlarm: { addListener: () => {} },
      },
    } as unknown as typeof chrome
    registerDiagnostics(
      'browseros',
      async () => 'http://127.0.0.1',
      ASTER_REPORTER_ID,
    )
    if (!externalListener)
      throw new Error('External listener was not registered')
    const sender = { id: ASTER_REPORTER_ID } as chrome.runtime.MessageSender
    expect(
      externalListener(
        { type: 'browseros:diagnostics:other' },
        sender,
        () => {},
      ),
    ).toBe(false)
    expect(
      externalListener(
        { type: 'browseros:diagnostics:get', maxAgeMs: 0 },
        { id: BROWSEROS_REPORTER_ID } as chrome.runtime.MessageSender,
        () => {},
      ),
    ).toBe(false)

    const handled = externalListener(
      { type: 'browseros:diagnostics:get', maxAgeMs: 0 },
      sender,
      () => {},
    )
    expect(handled).toBe(true)
    const response = await new Promise<unknown>((resolve) => {
      externalListener?.(
        { type: 'browseros:diagnostics:get', maxAgeMs: 0 },
        sender,
        resolve,
      )
    })
    expect(response).toMatchObject({
      snapshot: { schemaVersion: 1, product: 'browseros' },
      cached: false,
    })
  })
  it('bounds a source which never answers', async () => {
    await expect(within(() => new Promise(() => {}), 5)).rejects.toThrow(
      'timed out',
    )
  })
})
