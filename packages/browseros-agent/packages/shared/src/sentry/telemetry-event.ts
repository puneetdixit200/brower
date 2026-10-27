/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const SAFE_ERROR_TYPES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'SQLiteError',
])
const SAFE_LEVELS = new Set([
  'fatal',
  'error',
  'warning',
  'log',
  'info',
  'debug',
])
const SAFE_PLATFORMS = new Set(['javascript', 'node', 'bun'])

type UnknownRecord = Record<string, unknown>

/**
 * Build a content-free Sentry event. Free text, request/user data, tags,
 * contexts, breadcrumbs, extras, local variables, URLs, and source snippets
 * are intentionally discarded even when telemetry consent is enabled. Stack
 * frames retain only positive line/column numbers and the in-app marker.
 */
export function createContentFreeTelemetryEvent(event: unknown): UnknownRecord {
  if (!isRecord(event)) return {}

  const safe: UnknownRecord = {}
  copyString(event, safe, 'event_id', /^[0-9a-f-]{16,64}$/i)
  copyString(event, safe, 'timestamp', /^\d{4}-\d\d-\d\dT[\d:.+-]+Z$/)
  copySafeSetString(event, safe, 'platform', SAFE_PLATFORMS)
  copySafeSetString(event, safe, 'level', SAFE_LEVELS)
  copyString(event, safe, 'release', /^[A-Za-z0-9._+-]{1,100}$/)
  copyString(event, safe, 'environment', /^[A-Za-z0-9._+-]{1,40}$/)

  if (isRecord(event.exception) && Array.isArray(event.exception.values)) {
    const values = event.exception.values
      .slice(0, 5)
      .filter(isRecord)
      .map(sanitizeExceptionValue)
    if (values.length) safe.exception = { values }
  }

  return safe
}

function sanitizeExceptionValue(value: UnknownRecord): UnknownRecord {
  const safe: UnknownRecord = { type: safeErrorType(value.type) }
  const stacktrace = isRecord(value.stacktrace) ? value.stacktrace : undefined
  const frames = Array.isArray(stacktrace?.frames)
    ? stacktrace.frames.slice(-64).filter(isRecord).map(sanitizeFrame)
    : []
  if (frames.length) safe.stacktrace = { frames }
  return safe
}

function sanitizeFrame(frame: UnknownRecord): UnknownRecord {
  const safe: UnknownRecord = {}
  for (const key of ['lineno', 'colno'] as const) {
    const number = frame[key]
    if (
      typeof number === 'number' &&
      Number.isSafeInteger(number) &&
      number > 0
    ) {
      safe[key] = number
    }
  }
  if (typeof frame.in_app === 'boolean') safe.in_app = frame.in_app
  return safe
}

function safeErrorType(value: unknown): string {
  return typeof value === 'string' && SAFE_ERROR_TYPES.has(value)
    ? value
    : 'Error'
}

function copyString(
  source: UnknownRecord,
  target: UnknownRecord,
  key: string,
  pattern: RegExp,
): void {
  const value = source[key]
  if (typeof value === 'string' && pattern.test(value)) target[key] = value
}

function copySafeSetString(
  source: UnknownRecord,
  target: UnknownRecord,
  key: string,
  accepted: Set<string>,
): void {
  const value = source[key]
  if (typeof value === 'string' && accepted.has(value)) target[key] = value
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
