/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { expect, test } from 'bun:test'
import { createContentFreeTelemetryEvent } from './telemetry-event'

test('retains only bounded crash metadata and sanitized software locations', () => {
  const safe = createContentFreeTelemetryEvent({
    event_id: '0123456789abcdef0123456789abcdef',
    timestamp: '2026-10-27T12:34:56.000Z',
    platform: 'bun',
    level: 'error',
    release: '1.2.3',
    environment: 'production',
    message: 'PROMPT_SENTINEL response=RESPONSE_SENTINEL',
    user: { id: 'USER_SENTINEL', email: 'user@example.invalid' },
    request: { url: 'https://example.invalid/?token=TOKEN_SENTINEL' },
    tags: { authorization: 'Bearer CREDENTIAL_SENTINEL' },
    extra: { password: 'PASSWORD_SENTINEL' },
    contexts: { browser: { comment: 'COMMENT_SENTINEL' } },
    breadcrumbs: [{ message: 'BREADCRUMB_SENTINEL' }],
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'response=RESPONSE_SENTINEL password=PASSWORD_SENTINEL',
          stacktrace: {
            frames: [
              {
                function: 'buildRequest',
                module: 'chat',
                filename: '/home/alice/private/PROMPT_SENTINEL/server.ts',
                abs_path: '/home/alice/private/PROMPT_SENTINEL/server.ts',
                lineno: 12,
                colno: 8,
                in_app: true,
                vars: { comment: 'COMMENT_SENTINEL' },
                pre_context: ['PROMPT_SENTINEL'],
              },
            ],
          },
        },
      ],
    },
  })

  expect(safe).toEqual({
    event_id: '0123456789abcdef0123456789abcdef',
    timestamp: '2026-10-27T12:34:56.000Z',
    platform: 'bun',
    level: 'error',
    release: '1.2.3',
    environment: 'production',
    exception: {
      values: [
        {
          type: 'TypeError',
          stacktrace: {
            frames: [
              {
                lineno: 12,
                colno: 8,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
  })

  const serialized = JSON.stringify(safe)
  for (const sentinel of [
    'PROMPT_SENTINEL',
    'RESPONSE_SENTINEL',
    'COMMENT_SENTINEL',
    'PASSWORD_SENTINEL',
    'CREDENTIAL_SENTINEL',
    'TOKEN_SENTINEL',
    'USER_SENTINEL',
    'BREADCRUMB_SENTINEL',
    'alice',
  ]) {
    expect(serialized).not.toContain(sentinel)
  }
})

test('normalizes arbitrary exception types and drops unsafe location fields', () => {
  expect(
    createContentFreeTelemetryEvent({
      exception: {
        values: [
          {
            type: 'Password=SECRET_SENTINEL',
            value: 'SECRET_SENTINEL',
            stacktrace: {
              frames: [
                {
                  function: 'PROMPT_SENTINEL',
                  module: 'module/name',
                  filename: '/private/PROMPT_SENTINEL.ts?token=SECRET_SENTINEL',
                },
              ],
            },
          },
        ],
      },
    }),
  ).toEqual({
    exception: {
      values: [
        {
          type: 'Error',
          stacktrace: { frames: [{}] },
        },
      ],
    },
  })
})
