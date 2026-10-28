/**
 * Human-review preview for agent tool input. This is a display-only summary:
 * it never changes the original input passed to the authorized tool.
 *
 * Do not serialize arbitrary tool input to the DOM. It may contain credentials,
 * large binary blobs, nested API outputs, or attacker-controlled page text.
 */
const SENSITIVE_KEY = /(pass(word|phrase)?|secret|token|api.?key|authorization|cookie|credential|private.?key|session.?id|otp|one.?time.?code|2fa|mfa|csrf)/i
const SENSITIVE_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+)/i
const MAX_DEPTH = 5
const MAX_FIELDS = 24
const MAX_ITEMS = 24
const MAX_STRING = 400
const MAX_OUTPUT = 6000

function cleanText(value: string): string {
  // Preserve the destination origin for human review without exposing query
  // parameters. URLs containing ?secret= are not hidden wholesale.
  if (/^https?:\/\//i.test(value)) {
    try {
      const address = new URL(value)
      if (address.username || address.password) return '[redacted URL credentials]'
      // Query and fragment frequently carry reset tokens or session state.
      if (address.search || address.hash) return address.origin + address.pathname + ' [query/fragment omitted]'
      return address.toString()
    } catch {
      return '[invalid URL]'
    }
  }
  if (SENSITIVE_VALUE.test(value)) return '[redacted: credential-shaped content]'
  if (value.length > MAX_STRING) return value.slice(0, MAX_STRING) + '… [truncated]'
  return value
}

function sanitizedPreview(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return cleanText(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }
  if (typeof value === 'bigint') return '[numeric value]'
  if (typeof value !== 'object') return '[unsupported value]'
  if (depth >= MAX_DEPTH) return '[nested data omitted]'
  if (seen.has(value)) return '[circular reference]'
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map((item) =>
        sanitizedPreview(item, depth + 1, seen),
      )
      if (value.length > MAX_ITEMS) items.push('[additional items omitted]')
      return items
    }
    const entries = Object.entries(value).slice(0, MAX_FIELDS)
    const result: Record<string, unknown> = {}
    for (const [key, child] of entries) {
      result[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : sanitizedPreview(child, depth + 1, seen)
    }
    if (Object.keys(value).length > MAX_FIELDS) result['…'] = '[additional fields omitted]'
    return result
  } finally {
    seen.delete(value)
  }
}

export function formatApprovalInput(input: unknown): string {
  try {
    const summary = JSON.stringify(sanitizedPreview(input, 0, new WeakSet()), null, 2)
    if (!summary) return 'No action details were provided.'
    if (summary.length > MAX_OUTPUT) {
      return summary.slice(0, MAX_OUTPUT) + '\n… [additional action details omitted]'
    }
    return summary
  } catch {
    return 'Action details are unavailable. Deny if the destination is unclear.'
  }
}
