/** Maximum persisted display-only assistant text for one run. */
export const MAX_PARTIAL_ASSISTANT_TEXT_BYTES = 16 * 1024

/** Truncates at a Unicode code-point boundary without exceeding the UTF-8 byte cap. */
export function capPartialAssistantTextUtf8(
  value: string,
  maxBytes = MAX_PARTIAL_ASSISTANT_TEXT_BYTES,
): string {
  let bytes = 0
  let result = ''
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    result += character
    bytes += size
  }
  return result
}
