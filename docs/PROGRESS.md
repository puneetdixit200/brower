# Progress

## Current phase: Phase 7 — local memory and history retrieval

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
- Added `tests/e2e/aster_ui_latency_benchmark.py`; a headed isolated-profile run recorded 100 synthetic Search input events after 10 warmups (median 16.7 ms, p95 17.3 ms). This measures through the next animation frame and checks the React button state; it does not establish physical keyboard or compositor-presented latency. Raw samples are in [`perf/aster-home-input-2026-10-27.json`](perf/aster-home-input-2026-10-27.json).
- Updated `FEATURE_MATRIX.md`, `UI_REFERENCE.md`, `KNOWN_LIMITATIONS.md`, and the Linux runner guide. U04/U05 are PASS for the verified home mode/search flow; full agent task behavior remains unverified.

### Phase 4 — composer and tab context (partial)

- The home composer now shares the side panel's `@` current-window tab picker. Typing `@` at a word boundary opens it, typing filters by tab title/URL, and Escape cancels the unfinished mention while preserving surrounding text. Selection adds the tab to the existing attached-tabs set.
- Pure tests cover mention boundary, email exclusion, filtering, marker removal, and edit cancellation. `bun test apps/app/screens/agent-command/tab-mention.test.ts` passes (5/5); app typecheck and targeted Biome pass.
- Headed BrowserOS v0.51.0 live check opened a local health endpoint in a second tab, typed `@`, saw that tab in the picker, selected it (`Tabs 1`), and pressed Escape; the mention closed and unfinished `@` text was removed. No external page or provider credential was used.
- U06 is PARTIAL: current-window web-tab mentions are verified; history and memory mentions are not implemented, and files remain a separate attach action.

### Phase 5 — local mocked page-question stream (partial)

- Started the supervised dev browser in a network-isolated namespace with `BROWSEROS_USE_MOCK_LLM=true`. Added a disposable OpenAI-shaped provider row containing a test-only dummy key, selected it, attached `http://127.0.0.1:<port>/system/health`, and asked for the page title.
- The real home submit path navigated to the chat surface, sent the selected tab context through the extension/server chat route, and rendered the full canned response. Server logs recorded the chat request and `Agent execution complete`; provider row was deleted before shutdown. No real credential or external model request was used.
- A01 is PARTIAL: transport and page-context display pass, but the mock response does not establish page comprehension, browser tool execution, approvals, or real provider behavior.

### Phase 5 follow-up — deterministic browser-tool fixture (partial)

- Added an opt-in `BROWSEROS_MOCK_TOOL_CALL=tabs.list` fixture path to the mock language model. It can emit only the fixed read-only `tabs` list call, runs once per model instance, then returns the existing canned response. It is disabled by default and accepts no caller-supplied tool name or arguments.
- Headed Linux verification used a disposable profile in a network-isolated namespace. A chat request went through the real agent loop and its required loopback MCP lease; the stream showed `tool-input-available`, then `tool-output-available` with the live `[1] chrome://newtab/ (New Tab)` result, and completed with the canned follow-up response. Server logs independently showed the `tabs` call and `Agent execution complete`.
- A disposable dummy provider row was used only to exercise the setup surface and deleted before shutdown. No external model request or real credential was used. Browser and server stopped cleanly.
- The focused fixture test passes (1/1); a first filtered typecheck attempt hit TS2589, while the subsequent full workspace typecheck passed, including the server package. The fixture test and Biome formatting are clean.
- A follow-up MCP policy run passed 18/18 across `browser-mcp-module.test.ts` and `mcp.test.ts`. It verifies a read-only lease cannot be widened by a client query, rejects `tabs.new` under that lease, and omits `navigate` from an externally requested read-only tool surface. These are read-only denials, not interactive approval support.
- This proved one read-only tool dispatch end to end; approval work below now covers one mutation boundary. Page comprehension, cancellation, retries, multi-step tasks, and real-provider behavior remain unverified.

### Phase 7 — approval gate and response path (partial)

- Added server-side tool approval decisions to `ToolLoopAgent`. Browser `act`, code execution (`run`/`evaluate`), file upload/download/write/delete, tab close, and connector tools whose name or description indicates external/destructive side effects require user approval. Read-only observations and navigation continue without a prompt. Decisions are evaluated after the model proposes a call and before execution.
- Approval requests carry a server-only, process-scoped HMAC secret. The extension UI now renders the reason and redacted input details with Approve and Deny controls; the response request sends only the approval ID, decision, and optional reason. The server applies that decision only to a still-pending approval already in its own conversation history and requires a trusted local app origin. Unknown, stale, duplicate, and originless responses fail closed. A server restart invalidates the process-scoped HMAC key, so unresolved approvals cannot resume across restart yet.
- Headed BrowserOS v0.51.0 verification ran in a network-isolated namespace with the fixed `act.click` mock fixture. The real agent stream emitted `tool-approval-request` before the action executed. Sending Deny resumed the stream with `tool-output-denied` and the final assistant response. A forged approval ID returned HTTP 409 `No matching pending tool approval`; originless approvals return 403 in route tests. The browser action was not executed in the denial run.
- Focused policy, pending-response, mock-model, route-auth and request-shaping tests passed (30/30 across five test files), the full workspace typecheck passed, and targeted Biome passed. In the headed isolated UI run, the pending card stayed expanded, Deny was visible/clickable, and clicking it completed the mocked assistant turn. Temporary dummy provider rows were deleted, and the browser/server shut down cleanly. The Approve path and actual approved browser action remain unverified.
- A06 is PARTIAL: runtime gating, classified external tool verbs, unknown-tool fail-closed behavior, and headed UI denial are verified; an approved action, a concrete send/payment fixture, editable allow/ask/deny rules, persistence, and restart recovery remain. A09 remains PARTIAL: only existing read-only mode and new approval gates exist; Guard/Full access modes are not implemented.

### Privacy hardening — remote connector opt-in (partial)

- Removed automatic Klavis proxy startup. Home/sidebar no longer fetch remote integration status on mount; opening Connect Apps activates the optional connector service. The dedicated Apps settings screen is also an explicit activation point.
- Protected `/klavis/*` with trusted local extension-origin middleware. Route tests reject originless activation and accept the registered extension origin.
- In a network-isolated headed run, startup and the closed home produced no Klavis request logs. Opening Connect Apps triggered integration and proxy requests, which the namespace blocked. No external response was received.
- Targeted tests: server route suite 19/19 passed; full workspace typecheck passed; targeted Biome passed. S03 remains PARTIAL because the complete MCP route set, packaged ports, telemetry, updater, and other outbound traffic have not been audited.

### Local API route authentication audit (partial)

- Route review found `/mcp-manager/*` connector install/uninstall and `/oauth/*` state-changing start/token paths were mounted before any trusted-app guard. Hono applies middleware in registration order, so these guards now register before the routes; OAuth additionally requires an explicit trusted app origin even for GET because `/start` creates OAuth state.
- Route tests cover originless connector install/OAuth rejection and extension-origin success. Workspace typecheck passed.
- A second review found chat submissions could use caller-supplied provider credentials without app-origin auth, while conversation state/stream and stop routes were unauthenticated. The entire `/chat/*` surface now requires an explicit trusted extension origin. Originless tests verify state, stream, stop, and submission requests fail; extension-origin chat and stream tests pass.
- `/mcp` internal agent calls use a server-issued lease; external MCP now requires a persistent bearer token. The `/system/shutdown` route still accepts originless localhost restart requests for shipped BrowserOS compatibility, so another local process can request shutdown. Packaged ports, telemetry/updater, and third-party requests remain to audit.

### Current blockers / limits

- Aster still inherits BrowserOS UI, branding, product identity, and distribution/update wiring. No modified Chromium shell, installer, desktop entry, or release artifact has been produced.
- AppImage-backed `server.integration.test.ts` still fails in the automated helper profile before CDP startup with `chrome_crashpad_handler: --database is required`; the supervised headed Wayland flow succeeds.
- Existing telemetry/Sentry and external integration behavior needs an explicit opt-in review before Aster release; the stock first launch may have initiated upstream startup requests. No user credentials were used.
- The full upstream test suite is not green; prioritize Linux-targeted tests and document baseline failures separately.

### Next action

Run an actual third-party MCP client against the authenticated endpoint, then audit packaged ports, telemetry/updater, and remaining third-party requests. Add explicit approval-rule configuration and Guard/Full modes; verify an approved-action fixture and external send/payment fixture. Continue U06 history/file/memory context, matched browser benchmarks, shell regressions, and inherited extension identity/updater cleanup before distribution work.


### Phase 7 follow-up — persistent external MCP authentication (implemented; packaged verification pending)

- External `/mcp` POSTs now require a durable bearer token unless they carry a valid server-issued internal conversation lease. Read-only query flags do not bypass authentication. The token is generated once under the BrowserOS state directory with directory mode `0700` and file mode `0600`; comparison uses `timingSafeEqual`.
- The trusted extension settings endpoint exposes the token for manual client setup through an origin-checked JSON POST. Chrome omits Origin on extension GET requests, so the initial GET implementation was rejected in a headed run; changing to POST fixed the live settings flow. One-click HTTP client installs and boot-time URL reconciliation write the Authorization header. If the proxy URL is unavailable at startup, reconciliation preserves the existing manifest URL while migrating the header. The manual setup panel includes authenticated snippets.
- Added focused tests for denied external access, continued internal lease behavior, token persistence/permissions, and client config emission. A headed, network-isolated BrowserOS run verified that the settings UI displays the persisted credential, the external-facing `/mcp` endpoint returns 401 without it and 200 with it, and the file is mode 0600 after restart. A third-party MCP client round-trip and packaged updater/runtime behavior remain release checks.
- Current coverage at this checkpoint: focused MCP/settings tests pass (66/66 across isolated test runs); server and app typechecks pass independently. A single combined Bun invocation is unsuitable because the route test's module mock collides with MCP manager tests. The implementation and live UI/API path are committed; a third-party MCP client and packaged build remain unverified.

### Phase 7 follow-up — explicit local memory (partial)

- Added migrations `0015`–`0017` for user-authored notes, settings, and SQLite FTS5 indexing. Packaged builds without migration resources receive the same current schema from the database bootstrap path. FTS insert/update/delete triggers keep search in sync.
- The new Memory settings page supports create, edit, search, delete, retention (30 days / 90 days / until deleted), and a separate retrieval enable switch. Retrieval defaults off. Automatic task/chat extraction is not present; browser history is not copied into this store.
- Notes and provenance are stored in SQLite under the server database location and mirrored to a generated `memory/MEMORY.md` file with mode `0600`; its directory is forced to `0700`. The app rejects common credential-shaped content, credential-bearing source URLs, and non-HTTP(S) links. Notes are not sent automatically; users can explicitly attach selected notes to a request through the composer.
- Focused coverage: memory store tests cover opt-in FTS, update/delete index consistency, database reopen, mirror permissions, expiry, and credential rejection; the API test verifies untrusted origin rejection and trusted-origin CRUD/search. All 4 memory tests pass; database migration tests pass (9/9). Server and app typechecks pass independently.
- Headed BrowserOS v0.51.0 in the network-isolated dev profile verified the page load, retrieval-off default, and add → search miss/hit → edit → delete through the extension UI and authenticated server API. The test note was deleted; the runner stopped cleanly. `tests/e2e/aster_memory_smoke.py` records the repeatable flow.
- Added a home-composer Memory picker. Notes must be searched and selected explicitly; up to three selected notes join that request as reference data, bounded to 8,000 note characters. The normal home-chat handoff keeps memory text out of the URL. Unit tests verify selection formatting, size limits, and one-use handoff behavior; a second headed isolated run verified search → select → remove and deleted its fixture note.
- This is an initial local memory surface, not Phase 7 completion. The `@` picker does not include memory or history. Browser-history retrieval, task-derived extraction, full secret redaction, incognito-specific task handling, provenance timeline, confirmed model receipt, and 10k/50k benchmarks remain unimplemented.
