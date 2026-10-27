/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const ALLOWED_EVENTS = new Set([
  'http_server.started',
  'chat.request',
  'mcp.request',
  'tool_executed',
  'usage_rollup',
])

/**
 * Accept only fixed event names and fields needed for content-free counts.
 * Provider/model labels, prompt data, tool names, source labels, and all
 * unknown properties are intentionally omitted.
 */
export function sanitizeMetricsEvent(
  eventName: string,
  input: Record<string, unknown>,
): { eventName: string; properties: Record<string, boolean | number> } | null {
  if (!ALLOWED_EVENTS.has(eventName)) return null
  if (eventName === 'tool_executed') {
    return {
      eventName,
      properties:
        typeof input.success === 'boolean' ? { success: input.success } : {},
    }
  }
  if (eventName === 'usage_rollup') {
    const properties: Record<string, number> = {}
    for (const key of [
      'interval_seconds',
      'mcp_requests_count',
      'tool_executions_count',
      'tool_executions_failed',
    ]) {
      const value = input[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        properties[key] = value
      }
    }
    return { eventName, properties }
  }
  return { eventName, properties: {} }
}
