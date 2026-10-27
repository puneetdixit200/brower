# Known limitations

## Aster UI runtime

- A cold launch can briefly block an unpacked extension URL until its service worker registers. Linux manual mode now waits for the worker and opens the home through CDP. The updated runner rendered Aster and passed headed Search, provider setup, theme, tab mention, local mocked page-question, and deterministic `tabs` tool-dispatch smokes on BrowserOS v0.51.0 in isolated profiles. The mock runs used a disposable provider row with a dummy test key, deleted before shutdown; no real credential or external model request was used. Semantic page understanding, mutation approvals, and real-provider error recovery remain unverified.

- This branch is an early Aster hardening and integration effort over pinned BrowserOS source, not yet a distributable Aster Browser. Product identity, UI design, desktop packaging, updater behavior, and a modified Chromium shell remain incomplete.
- Chromium source build is deferred on this 14 GiB host (upstream guidance calls for at least 16 GiB). The stock BrowserOS AppImage baseline was run in an isolated profile; tests say nothing about a modified Aster engine.
- Baseline media page loaded but playback/decode was not established. Synthetic scroll input passed; physical touchpad, suspend/resume, notifications, existing extensions, and password manager flows were not exercised.
- The pinned upstream `bun test` run failed: 2,838 pass, 157 skip, 110 fail, 9 errors across 3,105 tests. Linux-specific integration setup and timeout/resource-sensitive failures need triage before broad compatibility claims.
- The WXT development build passed with `NODE_OPTIONS=--max-old-space-size=4096`; output includes unresolved Geist font references and dependency annotation warnings. It produced an upstream-branded dev extension only.
- AppImage-backed `server.integration.test.ts` runs fail before CDP startup in the helper launch mode with `chrome_crashpad_handler: --database is required`, including headless and Wayland attempts. No integration assertions ran.
- The agent HTTP API now binds loopback, but CDP, proxy, native messaging, telemetry/Sentry, and third-party startup integrations still need a full local-only/privacy audit.
- Current upstream extension configuration embeds BrowserOS extension identity, updater URL, and externally connectable IDs. Do not distribute an Aster extension until those assumptions are removed or replaced with Aster-controlled values.
- Linux binary resolution and deferred extension-page startup are implemented in the Go dev supervisor, covered by tests, and exercised end-to-end with the AppImage.
- BrowserOS AppImage startup may have initiated upstream telemetry/integration requests; no credentials or personal browser data were used. Do not describe the baseline as offline.
- No baseline performance comparison exists yet. Keep feature, benchmark, and shipping claims limited to measured evidence.
