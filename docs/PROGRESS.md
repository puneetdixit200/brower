# Progress

## Current phase: Phase 3 — Aster UI foundation and performance harness

**Status: PARTIAL.** Phase 0 is complete against the upstream BrowserOS baseline. Phase 1 dependency installation, static checks, and the development extension build are complete; the full upstream test run has failures. Phase 2's Linux supervisor flow is verified end-to-end. Phase 3 has an Aster home visual foundation and a headed Search/Ask smoke. No Aster-branded browser binary or release package exists.

### Host and pinned source

- Host inventory: [`environment.txt`](environment.txt); Omarchy 4.0.6, x86_64, Hyprland/Wayland, AMD Lucienne integrated graphics, 14 GiB RAM.
- Upstream revision `0792066b8fc7377e59a9dbb2ced3a977cd6a1310`, branch `feat/aster-linux-ui`.
- Chromium source build remains deferred: host RAM is below the project’s 16 GiB guidance. Use upstream Linux release binary for daily-engine validation while agent/UI work proceeds.

### Phase 0 — upstream baseline (complete)

- Official BrowserOS v0.51.0 x64 AppImage SHA-256 verified against GitHub release metadata: `b586df72083c046e2ea2d1cc1b6463325ed4cb0c31975d48e09cc14215e3e7bf`.
- Launched as `puneet` in a fresh, private profile on Wayland; Chromium runtime 155.0.8309.26, AMD/Mesa acceleration active.
- `tests/e2e/stock_browser_smoke.py`: HTTPS and invalid-certificate handling, local navigation/form, scroll input, known-hash download, incognito context, bookmark/history, tab controls, and persistence across restart passed. Media element appeared but playback/decode was not established; physical touchpad input and existing extensions/passwords were not tested.
- Screenshot `screenshots/stock-browseros-newtab.png` is browser-window-only with unrelated desktop contents redacted.
- This is evidence about upstream BrowserOS only; do not label it Aster verification.

### Phase 1 — agent and extension toolchain (partial)

- Installed user-local Bun 1.4.2 and `bunx` alias from checksum-verified official release; frozen dependency install succeeded (1,858 packages).
- `bun run check`: exit 0; upstream Biome schema-version warnings and fallow report remain.
- Raw `bun test` before the Linux integration fixes: exit 1, 3,105 tests: 2,838 pass, 157 skip, 110 fail, 9 error. Failures included a hard-coded macOS BrowserOS path, timeout/resource-sensitive tests, and live catalogue/provider expectations. These were pinned-upstream baseline results, not Aster regression results.
- `NODE_OPTIONS=--max-old-space-size=4096 bun run build:agent:dev`: exit 0 in 72.84 s at initial baseline. WXT emitted unresolved font-reference and upstream Rollup annotation warnings. The current dev manifest carries Aster display name/icons, but still inherits BrowserOS extension identity and updater assumptions.

### Aster implementation changes

- `packages/browseros-agent/apps/server/src/main.ts` binds the browser-control HTTP service to `127.0.0.1`.
- `packages/browseros-agent/apps/server/src/api/server.ts` now defaults to loopback if no host is supplied.
- `packages/browseros-agent/apps/server/tests/main.test.ts` asserts the loopback bind; targeted `bun test apps/server/tests/main.test.ts` passed (3/3).
- This closes the observed `0.0.0.0:9200` exposure in the upstream baseline. CDP listener exposure, remote telemetry behavior, other services, and production package behavior still require audit.
- Linux dev binary selection accepts `ASTER_BROWSER_BIN`, `ASTER_BROWSER_BINARY`, `BROWSEROS_BINARY`, or `browseros` on `PATH`; it never silently substitutes system Chromium. Server integration test runtime uses the same override order.
- Targeted Biome check passed on all five changed TypeScript files. `@browseros/server` typecheck passes after simplifying the new regression assertion.

### Phase 2 — Linux dev launcher (complete for the current source build)

- Added `packages/browseros-agent/tools/dev/linux/run.sh` and `README.md`. The runner uses the pinned manual dev mode and can use the user-local Go/Bun installs.
- Go supervisor derives the extension ID from the built manifest, waits for the extension service worker before opening its home through CDP on Linux, uses a worktree-specific profile under the user cache with mode 700, and stores agent state in that profile tree in another mode-700 directory.
- Linux watch mode reserves available loopback ports without terminating unrelated listeners. Agent HTTP API binds to `127.0.0.1`; Chromium sandbox remains enabled.
- Live verification in a network-isolated namespace: BrowserOS window opened under Wayland; CDP came up on loopback; extension home rendered; extension-page `fetch()` to `/system/health` returned `{"status":"ok","cdpConnected":true}`; Ctrl+C shut down browser/server cleanly. Klavis access was blocked by the deliberately isolated network and produced retry logs.
- `go test ./...` passes across the dev supervisor packages; `bun test apps/server/tests/main.test.ts apps/server/tests/test-runtime.test.ts` passes (10/10).
- Follow-up live verification found BrowserOS v0.51.0 reads the extension API port from the server/proxy switches, not the legacy MCP switch alone. The Linux launcher now synchronizes all three switches to its selected port. Fresh-profile verification on random port 9784 confirmed provider endpoints returned `200`, an empty provider list settled into the “Connect a provider” state (rather than loading indefinitely), and health remained `ok`.
- Live theme verification used the actual menu keyboard interaction: Dark applied `html.dark` and Aster ink `#e3efe8`; Light applied `html.light` and ink `#173b35`. Both directions passed.
- `go test ./browser ./proc ./cmd` passes after the port regression test. The second isolated headed runner shut down cleanly with Ctrl+C.

### Phase 3 — home interface foundation (partial)

- Added scoped light/dark Aster home colors, original star mark and toolbar icons, Search / Ask AI mode controls, full-bleed home layout, and Aster display labels in the sidebar and extension manifest/action.
- Search opens explicit HTTP(S) URLs and bare hostnames; other text becomes an encoded Google search. Non-web schemes never navigate directly. Search is user-submitted and opens a new browser tab.
- Ask AI retains BrowserOS's existing provider/agent composer and selected-tab/file context controls. Recent sites and scheduled tasks remain; upstream promotional cards were removed from the Aster home screen.
- `go test ./...` passes, including CDP-deferred extension opening tests. Six Search parser tests pass; app typecheck and targeted Biome pass. The updated extension build passes as the desktop user with `NODE_OPTIONS=--max-old-space-size=4096`. Existing unresolved-font, Rollup-annotation, and large-chunk warnings remain.
- The cold-start race is resolved in Linux manual mode: it waits for the unpacked extension worker then opens the home through CDP. Headed BrowserOS v0.51.0 smoke verified Aster branding and Ask composer, Search submission to an encoded Google URL, settled provider setup state, and both light/dark theme states. The namespace had no external network. Captured [`screenshots/aster-home.png`](screenshots/aster-home.png).
- Updated `FEATURE_MATRIX.md`, `UI_REFERENCE.md`, `KNOWN_LIMITATIONS.md`, and the Linux runner guide. U04/U05 are PASS for the verified home mode/search flow; full agent task behavior remains unverified.

### Current blockers / limits

- Aster still inherits BrowserOS UI, branding, product identity, and distribution/update wiring. No modified Chromium shell, installer, desktop entry, or release artifact has been produced.
- AppImage-backed `server.integration.test.ts` still fails in the automated helper profile before CDP startup with `chrome_crashpad_handler: --database is required`; the supervised headed Wayland flow succeeds.
- Existing telemetry/Sentry and external integration behavior needs an explicit opt-in review before Aster release; the stock first launch may have initiated upstream startup requests. No user credentials were used.
- The full upstream test suite is not green; prioritize Linux-targeted tests and document baseline failures separately.

### Next action

Continue Phase 3 shell states and build a matched startup/idle baseline harness. Next prioritize existing browser shell navigation/tab regressions on the Aster home, then audit and remove inherited extension identity/updater assumptions before any distribution work.
