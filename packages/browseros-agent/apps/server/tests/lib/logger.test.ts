/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Logger,
  redactSensitiveMetadata,
  shouldRotateLog,
} from '../../src/lib/logger'

const DAY_MS = 24 * 60 * 60 * 1000
const MB = 1024 * 1024

describe('redactSensitiveMetadata', () => {
  it('redacts credential and private-key fields recursively, including arrays', () => {
    class AuthMetadata {
      accessToken = 'CLASS_TOKEN_SENTINEL'
    }
    const cyclic: Record<string, unknown> = { requestId: 'cycle-safe' }
    cyclic.self = cyclic
    const metadata = {
      requestId: 'ordinary-value',
      api_key: 'TOP_LEVEL_API_KEY_SENTINEL',
      secretAccessKey: 'TOP_LEVEL_SECRET_ACCESS_KEY_SENTINEL',
      aws_access_key_id: 'AWS_ACCESS_KEY_SENTINEL',
      authTokenValue: 'AUTH_TOKEN_VALUE_SENTINEL',
      authHeader: 'AUTH_HEADER_SENTINEL',
      profile: {
        accessToken: 'NESTED_TOKEN_SENTINEL',
        details: [{ private_key: 'ARRAY_PRIVATE_KEY_SENTINEL' }],
        displayName: 'ordinary-name',
        identity: new AuthMetadata(),
      },
      cyclic,
      map: new Map([
        ['apiKey', 'MAP_API_KEY_SENTINEL'],
        ['state', 'kept'],
      ]),
      date: new Date('2026-10-30T00:00:00.000Z'),
      error: new Error('do not log this free-form message'),
    }

    expect(redactSensitiveMetadata(metadata)).toEqual({
      requestId: 'ordinary-value',
      api_key: '[REDACTED]',
      secretAccessKey: '[REDACTED]',
      aws_access_key_id: '[REDACTED]',
      authTokenValue: '[REDACTED]',
      authHeader: '[REDACTED]',
      profile: {
        accessToken: '[REDACTED]',
        details: [{ private_key: '[REDACTED]' }],
        displayName: 'ordinary-name',
        identity: { accessToken: '[REDACTED]' },
      },
      cyclic: { requestId: 'cycle-safe', self: '[Circular]' },
      map: { apiKey: '[REDACTED]', state: 'kept' },
      date: '2026-10-30T00:00:00.000Z',
      error: { name: 'Error', message: '[Error details omitted]' },
    })
    expect(metadata.api_key).toBe('TOP_LEVEL_API_KEY_SENTINEL')
    expect(metadata.secretAccessKey).toBe(
      'TOP_LEVEL_SECRET_ACCESS_KEY_SENTINEL',
    )
    expect(() =>
      new Logger('info').info('cycle-safe log', { cyclic }),
    ).not.toThrow()
  })

  it('writes redacted metadata to the configured file logger', async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browseros-logger-'))
    const logPath = path.join(logDir, 'browseros-server.log')
    const testLogger = new Logger('info')
    testLogger.setLogFile(logDir)

    try {
      testLogger.info('redaction test', {
        authorization: 'FILE_AUTH_SENTINEL',
        nested: { client_secret: 'FILE_SECRET_SENTINEL', requestId: 'kept' },
      })

      let logText = ''
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (fs.existsSync(logPath)) logText = fs.readFileSync(logPath, 'utf8')
        if (logText.includes('redaction test')) break
        await Bun.sleep(10)
      }

      expect(logText).toContain('[REDACTED]')
      expect(logText).toContain('"requestId":"kept"')
      expect(logText).not.toContain('FILE_AUTH_SENTINEL')
      expect(logText).not.toContain('FILE_SECRET_SENTINEL')
    } finally {
      await testLogger.closeFile()
      fs.rmSync(logDir, { recursive: true, force: true })
    }
  })
})

describe('shouldRotateLog', () => {
  it('rotates a log older than the max age', () => {
    expect(shouldRotateLog(1 * MB, 0, DAY_MS + 1)).toBe(true)
  })

  it('rotates a log larger than the size cap', () => {
    const now = 1_000_000
    expect(shouldRotateLog(60 * MB, now, now)).toBe(true)
  })

  it('leaves a small, recent log alone', () => {
    const now = 1_000_000
    expect(shouldRotateLog(1 * MB, now, now)).toBe(false)
  })

  it('does not rotate exactly at the age boundary', () => {
    expect(shouldRotateLog(1 * MB, 0, DAY_MS)).toBe(false)
  })
})
