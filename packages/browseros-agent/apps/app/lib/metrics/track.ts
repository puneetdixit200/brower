/**
 * BrowserOS native logMetric has no app-owned consent or payload boundary.
 * Keep call sites source-compatible while the app telemetry slice stays off.
 */
export function track(
  _eventName: string,
  _properties?: Record<string, unknown>,
): void {
  // Deliberately do not forward app events to chrome.browserOS.logMetric.
}
