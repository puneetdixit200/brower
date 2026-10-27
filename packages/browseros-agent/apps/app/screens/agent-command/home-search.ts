/** Resolve a home-search query to a safe destination. */
export function resolveHomeSearchUrl(query: string): string | null {
  const value = query.trim()
  if (!value) return null

  // Only allow explicitly web-safe schemes. Never pass script:, file:, or
  // browser-internal URLs through the user-facing search box.
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.toString()
        : null
    } catch {
      return null
    }
  }

  // Treat a bare hostname/path as navigation; everything else is a search.
  if (
    /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/\S*)?$/i.test(
      value,
    )
  ) {
    const scheme =
      /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\/|$)/i.test(value)
        ? 'http'
        : 'https'
    return `${scheme}://${value}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}
