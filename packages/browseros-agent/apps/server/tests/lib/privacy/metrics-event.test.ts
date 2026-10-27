/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { expect, test } from 'bun:test'
import { sanitizeMetricsEvent } from '../../../src/lib/privacy/metrics-event'

test('fixed metrics allowlist drops prompt, provider, model, and dynamic tool labels', () => {
  const fields = {
    prompt: 'PROMPT_SENTINEL',
    response: 'RESPONSE_SENTINEL',
    comment: 'COMMENT_SENTINEL',
    password: 'PASSWORD_SENTINEL',
    apiKey: 'APIKEY_SENTINEL',
    provider: 'https://custom-provider.invalid?token=TOKEN_SENTINEL',
    model: 'MODEL_SENTINEL',
    tool_name: 'PROMPT_SENTINEL',
    source: 'COMMENT_SENTINEL',
    success: false,
  }

  expect(sanitizeMetricsEvent('chat.request', fields)).toEqual({
    eventName: 'chat.request',
    properties: {},
  })
  expect(sanitizeMetricsEvent('tool_executed', fields)).toEqual({
    eventName: 'tool_executed',
    properties: { success: false },
  })
  expect(sanitizeMetricsEvent('unregistered.event', fields)).toBeNull()
  expect(
    sanitizeMetricsEvent('usage_rollup', {
      mcp_requests_count: 8,
      tool_executions_count: 3,
      tool_executions_failed: 1,
      tool_executions_by_tool: { secret: 4 },
      interval_seconds: 1800,
      period_start_ts: 'PROMPT_SENTINEL',
    }),
  ).toEqual({
    eventName: 'usage_rollup',
    properties: {
      interval_seconds: 1800,
      mcp_requests_count: 8,
      tool_executions_count: 3,
      tool_executions_failed: 1,
    },
  })

  const serialized = JSON.stringify(
    sanitizeMetricsEvent('tool_executed', fields),
  )
  for (const sentinel of [
    'PROMPT_SENTINEL',
    'RESPONSE_SENTINEL',
    'COMMENT_SENTINEL',
    'PASSWORD_SENTINEL',
    'APIKEY_SENTINEL',
    'TOKEN_SENTINEL',
    'MODEL_SENTINEL',
    'custom-provider',
  ]) {
    expect(serialized).not.toContain(sentinel)
  }
})
