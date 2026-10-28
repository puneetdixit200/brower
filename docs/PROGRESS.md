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
- `NODE_OPTIONS=--max-old-space-size=4096 bun run build:agent:dev`: exit 0 in 72.84 s at initial baseline. WXT emitted unresolved font-reference and upstream Rollup annotation warnings. At that baseline the dev manifest still inherited BrowserOS extension identity and updater assumptions.
- S05 follow-up: WXT uses a stable Aster-specific development public key (ID `oifdmombnijnaiocijiacjhajbnpdlhb`) with no updater URL, configured reporter extension ID, compatibility peer, or product-site web access by default. External extension connections are explicitly denied by the default manifest (`externally_connectable.ids: []`). Explicit release key and updater values must be paired; DER SPKI keys are parsed and rejected if their derived ID matches BrowserOS. Product-site origins reject BrowserOS, localhost, and IP literals. A 4 GB heap development build passed, and inspection confirmed the manifest contains the Aster dev key while omitting update and product-site resource fields. A subsequent review found that omitting `externally_connectable` allows extension callers in Chrome; the default is now explicitly empty; the 2026-10-28 fresh-profile runtime gates below verify default denial and configured reporter access. App typecheck and targeted Biome passed. Aster release infrastructure is not available, so S05 remains PARTIAL / BLOCKED.

### Aster implementation changes

- `packages/browseros-agent/apps/server/src/main.ts` binds the browser-control HTTP service to `127.0.0.1`.
- `packages/browseros-agent/apps/server/src/api/server.ts` now defaults to loopback if no host is supplied.
- `packages/browseros-agent/apps/server/tests/main.test.ts` asserts the loopback bind; targeted `bun test apps/server/tests/main.test.ts` passed (3/3).
- This closes the observed `0.0.0.0:9200` exposure in the upstream baseline. CDP listener exposure, remote telemetry behavior, other services, and production package behavior still require audit.
- Linux dev binary selection accepts `ASTER_BROWSER_BIN`, `ASTER_BROWSER_BINARY`, `BROWSEROS_BINARY`, or `browseros` on `PATH`; it never silently substitutes system Chromium. Server integration test runtime uses the same override order.
- Targeted Biome check passed on all five changed TypeScript files. `@browseros/server` typecheck passes after simplifying the new regression assertion.

### T06 current source evidence — 2026-10-29

- **T06.1:** The focused test passes 3/3 (18 assertions). It formats hostile page text through the real `formatSnapshotResult` path and sends deterministic send/post/payment proposals through the production `ToolLoopAgent` approval callback. This proves proposed side effects pause pending server approval; it does not demonstrate real-model prompt resistance or external integration wiring.
- **T06.2:** POSIX filesystem helpers use a descriptor-anchored no-follow walk; leaf opens now force `O_NONBLOCK` and `O_NOCTTY` where available. A FIFO regression verifies that callers omitting `O_NONBLOCK` do not hang. Linux `openat2` behavior is unchanged and Windows fails closed. The helper suite passes 16/16 (43 assertions), and the full filesystem suite passes 177/177 (386 assertions). Independent Luna review found no correctness regressions. This prevents FIFO-open hangs but does not close the portable POSIX device-node race: device-specific open-time effects can occur before the post-open regular-file check. Actual macOS/BSD execution is unverified.
- **T06.3:** Real Linux Bubblewrap tests use isolation sentinels under home, `/var/tmp`, and `/run`. The Bash suite passes 20/20 and is included in the full filesystem suite. Server typecheck, targeted Biome, and `git diff --check` pass.
- **Limits and next decisions:** Bubblewrap network egress remains enabled. No native Aster runtime/window is available, so packaged Aster acceptance is unverified. Keep S01 and S02 PARTIAL. Test macOS/BSD if supported or formally scope the path to Linux; resolve or explicitly accept the device-node race; decide network policy; verify packaged Aster on T20a and signed release gates. Overall matrix remains **2/72 PASS (2.8%)**.

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

### Phase 4 follow-up — per-tab side-panel drafts (partial)

- Added local draft storage keyed by the panel's owning tab ID. It restores the prompt and attached web-tab IDs when the panel reopens; stale or closed attachment IDs are dropped. Writes are skipped for incognito windows and when the owning window check cannot be resolved.
- Draft helper tests pass (2/2), app typecheck passes, and targeted Biome passes. Headed isolated BrowserOS smoke verified that a Translate prompt survives closing and reopening its owner tab's panel. Two-tab switching and browser restart recovery remain unverified; U15 is PARTIAL.
- Follow-up headed isolated smoke `tests/e2e/aster_sidepanel_draft_smoke.py` created two local owner tabs and a third local attachment tab, saved distinct prompts, attached the third tab to one owner through the picker, then closed and reopened each panel. Each owner received its own draft and the attached tab returned; the smoke passed. Browser restart recovery remains unverified, so U15 stays PARTIAL.

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

### Phase 5 follow-up — two-page task actions in one active tab (partial)

- Added an opt-in `BROWSEROS_MOCK_TOOL_CALL=a02.multi-page` fixture sequence. It resolves one selected Chrome tab ID to the MCP Page ID from the formatted Browser Context; if the exact marker or selected-tab mapping is absent or ambiguous, the fixture emits no tool calls. Tool names, action arguments, and loopback URLs are fixed in code.
- Headed, network-isolated BrowserOS v0.51.0 smoke used one active tab to visit local `/one` and `/two` forms, fill and submit both after four explicit approvals, then navigate to `/done`. CDP checked field values, the fixture recorded both submitted values, and the final page content was verified. The repeatable flow is `tests/e2e/aster_multi_page_smoke.py`.
- Mock fixture tests pass (10/10); server typecheck and targeted Biome pass; Python compilation and `git diff --check` pass. No external network or real provider credential was used. A02 is PARTIAL: this proves a deterministic sequence through the existing Browser MCP path, not model planning or semantic page comprehension. Typing into background tabs remains unverified.

### Phase 6 — split tabs and selection actions (partial)

- Source review found BrowserOS Chromium patch integration for the native split-view new-tab URL and a default-pinned Split Tab toolbar action. Aster does not currently own split-state UI or controls; two live panes and resize/swap/close/restart behavior have not been verified. Native Chromium compilation remains deferred on this 14 GiB host against the project's 16 GiB guidance.
- Existing selection capture is per tab. Summarize and Translate now insert the selected text itself into an editable composer draft inside a per-action nonce-matched untrusted-content fence; the page origin is included while path/query data is excluded. No provider request occurs until the user submits. Translation asks for a target language when one is missing.
- Helper tests cover selected-text inclusion, the origin-only metadata, and a hostile fake closing marker. The headed isolated BrowserOS smoke seeds a local selection fixture, verifies both fenced prompts, submits Summarize through the real side-panel chat route, receives the deterministic local mock response, and verifies the Translate draft restores after close/reopen. A prior headed run exercised content-script selection capture; this smoke isolates the prompt/composer path. Real-provider behavior and model comprehension remain untested. U11, U12, and U14 remain PARTIAL; screenshot/lasso tools (U13) are not implemented.

### Phase 7 — approval gate and response path (partial)

- Added server-side tool approval decisions to `ToolLoopAgent`. Browser `act`, code execution (`run`/`evaluate`), file upload/download/write/delete, tab close, and connector tools whose name or description indicates external/destructive side effects require user approval. Read-only observations and navigation continue without a prompt. Decisions are evaluated after the model proposes a call and before execution.
- Approval requests carry a server-only, process-scoped HMAC secret. The extension UI now renders the reason and redacted input details with Approve and Deny controls; the response request sends only the approval ID, decision, and optional reason. The server applies that decision only to a still-pending approval already in its own conversation history and requires a trusted local app origin. Unknown, stale, duplicate, and originless responses fail closed. A server restart invalidates the process-scoped HMAC key, so unresolved approvals cannot resume across restart yet.
- Headed BrowserOS v0.51.0 verification ran in a network-isolated namespace with the fixed `act.click` mock fixture. The real agent stream emitted `tool-approval-request` before the action executed. Sending Deny resumed the stream with `tool-output-denied` and the final assistant response. A forged approval ID returned HTTP 409 `No matching pending tool approval`; originless approvals return 403 in route tests. The browser action was not executed in the denial run.
- Focused policy, pending-response, mock-model, route-auth and request-shaping tests passed (30/30 across five test files), the full workspace typecheck passed, and targeted Biome passed. A headed, network-isolated denial run verified the pending card and Deny response.
- Follow-up approval smoke uses a disposable local page with one button and a dummy-only mock provider. A fixed snapshot → approval request → Approve sequence changed the fixture button text to `Clicked safely`; server logs recorded the approved `act` call and completed tool execution. The script deleted the provider and closed the fixture tab; a follow-up API check confirmed no test provider remained. This proves one approved local click, not an external send/payment or generalized action classifier.
- A06 is PARTIAL: runtime gating, classified external tool verbs, unknown-tool fail-closed behavior, and headed UI Deny and Approve are verified. The approved `act.click` changed a harmless local fixture after a snapshot. A concrete send/payment fixture, editable allow/ask/deny rules, persistence, and restart recovery remain. A09 remains PARTIAL: only existing read-only mode and approval gates exist; Guard/Full access modes are not implemented.

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

Follow the reviewed batches in [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), starting with S05 diagnostics identity and emitted-manifest regression gates. Release blockers remain S05 ownership, telemetry and outbound-traffic audit, external send/payment classification, Guard/Full policy configuration, native packaging, and matched stock/Aster browser performance.


### Phase 7 follow-up — persistent external MCP authentication (implemented; packaged verification pending)

- External `/mcp` POSTs now require a durable bearer token unless they carry a valid server-issued internal conversation lease. Read-only query flags do not bypass authentication. The token is generated once under the BrowserOS state directory with directory mode `0700` and file mode `0600`; comparison uses `timingSafeEqual`.
- The trusted extension settings endpoint exposes the token for manual client setup through an origin-checked JSON POST. Chrome omits Origin on extension GET requests, so the initial GET implementation was rejected in a headed run; changing to POST fixed the live settings flow. One-click HTTP client installs and boot-time URL reconciliation write the Authorization header. If the proxy URL is unavailable at startup, reconciliation preserves the existing manifest URL while migrating the header. The manual setup panel includes authenticated snippets.
- Added focused tests for denied external access, continued internal lease behavior, token persistence/permissions, and client config emission. A headed, network-isolated BrowserOS run verified that the settings UI displays the persisted credential, the external-facing `/mcp` endpoint returns 401 without it and 200 with it, and the file is mode 0600 after restart. A third-party MCP client round-trip and packaged updater/runtime behavior remain release checks.
- Current coverage at this checkpoint: focused MCP/settings tests pass (66/66 across isolated test runs); server and app typechecks pass independently. A single combined Bun invocation is unsuitable because the route test's module mock collides with MCP manager tests. The implementation and live UI/API path are committed; a third-party MCP client and packaged build remain unverified.

### Phase 7 follow-up — explicit local memory (partial)

- Added migrations `0015`–`0017` for user-authored notes, settings, and SQLite FTS5 indexing. Packaged builds without migration resources receive the same current schema from the database bootstrap path. FTS insert/update/delete triggers keep search in sync.
- The new Memory settings page supports create, edit, search, delete, retention (30 days / 90 days / until deleted), and a separate retrieval enable switch. Retrieval defaults off. Automatic task/chat extraction is not present; browser history is not copied into this store.
- Notes and provenance are stored in SQLite under the server database location and mirrored to `memory/MEMORY.md` with mode `0600`; its directory is forced to `0700`. Markdown content edits reconcile into SQLite and FTS when memory APIs are used; malformed structure, changed IDs/metadata, empty or oversized notes, and common credential-shaped content fail closed. Add/delete/reorder and metadata edits remain in Aster settings. The app also rejects credential-bearing source URLs and non-HTTP(S) links. Notes are not sent automatically; users can explicitly attach selected notes to a request through the composer.
- Focused coverage: memory store tests cover opt-in FTS, update/delete index consistency, database reopen, mirror permissions, expiry, and credential rejection; the API test verifies untrusted origin rejection and trusted-origin CRUD/search. All 4 memory tests pass; database migration tests pass (9/9). Server and app typechecks pass independently.
- Headed BrowserOS v0.51.0 in the network-isolated dev profile verified the page load, retrieval-off default, and add → search miss/hit → edit → delete through the extension UI and authenticated server API. The test note was deleted; the runner stopped cleanly. `tests/e2e/aster_memory_smoke.py` records the repeatable flow.
- Added a home-composer Memory picker. Notes must be searched and selected explicitly; up to three selected notes join that request as reference data, bounded to 8,000 note characters. The normal home-chat handoff keeps memory text out of the URL. Unit tests verify selection formatting, size limits, and one-use handoff behavior; a second headed isolated run verified search → select → remove and deleted its fixture note.
- Added a repeatable SQLite FTS search benchmark. With 10k synthetic notes, 120 warm measured searches had median 1.357 ms / p95 1.657 ms; with 50k, median 7.470 ms / p95 8.330 ms. This ran against a temporary `/tmp` database on tmpfs, so durable-disk cold reads and UI latency are not covered. Raw ordered samples and the runner are recorded in `docs/perf/aster-memory-search-2026-10-27.json` and `apps/server/tests/perf/memory-search.bench.ts`.
- Memory settings and selection now resolve the owning browser window and fail closed while that check is pending; the memory API rejects calls carrying the resulting incognito marker. This addresses Chromium's spanning-mode case where `chrome.extension.inIncognitoContext` alone is false for a side panel hosted by a private window. The API test verifies an incognito-marked save is rejected. A headed test in a real off-the-record BrowserOS context remains required; the header is not a security boundary against a hostile local caller.
- A headed off-the-record attempt in BrowserOS v0.51.0 was made in the disposable network-isolated profile. Chromium opened the extension URL but blocked it with `ERR_BLOCKED_BY_CLIENT`, leaving extension APIs unavailable, so the persistence assertion could not execute. M05 remains PARTIAL pending a BrowserOS runtime that supports loading the extension in an off-the-record context.
- Added a separate on-demand browser-history picker to the home composer. It uses `chrome.history.search`, filters results to HTTP(S), and attaches only explicitly selected titles, origins, and visit times (up to three); paths and query strings are stripped before the request is built. It stores no history copy and the picker is disabled in incognito contexts. The headed, network-isolated BrowserOS smoke selected and removed a local `/system/health` history entry, then deleted that history fixture; the shared smoke also passed the saved-memory CRUD and selection flow.
- This is an initial local memory/history surface, not Phase 7 completion. The `@` picker still searches current-window tabs only. Automatic task-derived extraction, broader secret redaction, a provenance timeline/version history, and confirmed model receipt remain unimplemented. Off-the-record extension behavior remains unverified because this BrowserOS runtime blocked the extension page. The synthetic 10k/50k FTS search benchmark is complete as recorded above; durable-disk cold reads and UI latency remain unmeasured.

### Phase 7 follow-up — editable Markdown mirror (partial)

- The local Markdown mirror now accepts content-only edits and reconciles them into SQLite on memory reads/writes/searches. Existing FTS triggers update search immediately; the canonical file is then regenerated with refreshed timestamps.
- Expired entries are removed from SQLite, FTS, and the Markdown mirror when pruning runs. Tests cover expiry persistence across database reopen and repeated reads after pruning.
- Reconciliation is conservative: malformed structure, missing/duplicate/unknown IDs, source metadata changes, empty/oversized content, and credential-shaped content abort without importing edits. Note creation, deletion, reordering, and metadata changes remain in Aster settings. The store tests verify FTS reflects a Markdown edit and preserves database content after rejected edits.
- Focused DB, memory-store, route, task-draft, and Task History helper suites pass (28/28); workspace typecheck and targeted Biome pass. Store tests also verify expiry pruning after a database reopen. Headed network-isolated BrowserOS smoke passed for task draft review/save/provenance, omission of a credential-shaped fixture, and existing note/history selection flows. Markdown edits were validated at the store/API layer, not through a filesystem editor in the headed browser.

### Phase 7 follow-up — reviewed task memory drafts (partial)

- Completed tasks with a non-empty result can be selected from the Memory settings page to create a local editable draft. Nothing is persisted until the user presses Save. Saving requires Memory to be enabled and stores the task ID/title with the note; edits preserve provenance, and the generated Markdown mirror identifies task sources.
- Draft generation uses the task's existing prompt and response text locally, makes no model call, and caps drafts at 8,000 characters. The UI offers at most the newest 20 completed tasks. Credential-shaped prompts/results are screened with the same heuristic patterns as memory storage and are omitted from the review list. This remains a review workflow rather than automatic episodic extraction; M02 remains PARTIAL.
- Added migration `0018_memory_task_provenance` and a bootstrap compatibility path for builds without migration resources. Database tests were updated to model pre-0018 databases accurately after the first run exposed a fixture that retained new columns while rewinding its migration marker.
- Focused DB, memory-store, route, task-draft, and Task History helper suites pass (28/28); the full workspace typecheck and targeted Biome check pass. Headed BrowserOS v0.51.0 in the network-isolated disposable profile verified retrieval-off by default, local task draft review, explicit save with displayed provenance, credential-shaped task omission, and fixture cleanup. The repeatable flow is `tests/e2e/aster_memory_smoke.py`. Credential-shaped note content and task titles are rejected by the store; this is heuristic screening, not comprehensive secret detection.

### Phase 8 follow-up — skip missed runs and guard overlap (partial)

- Scheduled-task startup no longer executes every missed job as a catch-up batch. It rebuilds BrowserOS alarms from enabled schedules, and an alarm delivered more than 60 seconds after its scheduled time is skipped. Same-job triggers are guarded within the extension worker; the existing persisted run records continue to provide restart visibility.
- Added policy tests for on-time, late, early, and invalid alarm timestamps. App typecheck passes. A real laptop sleep/restart test has not been performed, and skipped runs are not yet written as audit records.
- Routines remain partial: schedules still use the machine-local timezone, there is no explicit `skip`/`run once on wake` setting, heartbeat continuation is absent, no DST preview exists, and cross-context locking has not been proven.

### Phase 8 follow-up — scheduled task lifecycle smoke (partial)

- The existing scheduled-task UI's create → edit → manual Test → cancel → retry → disable → delete flow was exercised in headed BrowserOS v0.51.0 inside the network-isolated dev profile. The smoke observed a persisted completed run and rendered its result, canceled a visible running tool job and verified its persisted `Cancelled by user` failure, then removed the dummy provider to create a provider-resolution failure and used Retry after restoring it; the retry completed. Create installed an alarm, disable removed it, and delete returned 404 from the local jobs API. The provider, runs, job, and alarm were confined to the disposable profile.
- The repeatable smoke is `tests/e2e/aster_scheduled_task_lifecycle_smoke.py`. Schedule conversion, provider resolution, result selection, and alarm-policy tests pass (24/24). Active cancellation and failed-run retry now have headed verification; real recurring alarm firing, sleep/restart behavior, and timezone behavior remain unverified, so R01/R04 stay PARTIAL.

### Security follow-up — injection boundaries and secret redaction (partial)

- Review confirmed the BrowserOS agent prompt treats tool output as untrusted, browser tool text is wrapped in per-call nonce fences, and side-effectful calls use the approval policy. Prompt, approval-policy, and snapshot-fence tests pass (40/40). No headed hostile-page attempt against a protected action has been run; S01 stays PARTIAL.
- Common key, bearer, JWT, credential-URL and sensitive JSON patterns are scrubbed from user-visible provider error details; Sentry sanitizers redact selected sensitive-key values in traversed event data. Both app and server Sentry initializers now pass `sendDefaultPii: false`, preserving their existing `beforeSend` sanitizers. Focused tests assert this option is passed to each SDK. These tests confirm local configuration only; receipt, processing, and retention at the remote Sentry DSN are unverified. The focused chat-error and Sentry redaction tests pass (26/26). Full provider/telemetry outbound review, first-use disclosure and log-sink scans remain open; S04 stays PARTIAL.

### Phase 5 follow-up — stop an active tool run (partial)

- Added an opt-in deterministic `wait` tool call to the mock model fixture. The delay is environment-controlled, capped at 30 seconds, and is only used when the mock tool fixture is explicitly enabled.
- Headed BrowserOS v0.51.0 smoke ran in a network-isolated disposable profile with a dummy-only local provider. It submitted a chat, waited until the `wait` tool appeared, clicked the side-panel Stop control, observed server-owned run state transition from `running` to `aborted`, and confirmed the delayed mock response did not arrive. The provider and test tab were removed and the browser stopped cleanly.
- The repeatable smoke is `tests/e2e/aster_chat_cancel_smoke.py`. Focused mock-model, ConversationRuns, and `/chat` route tests pass (24/24); full workspace typecheck and Python syntax/diff checks pass. A real external provider and cancellation during browser navigation/click remain unverified, so A04 remains PARTIAL.

### Phase 5 follow-up — offline provider feedback (partial)

- A headed network-isolated run against a configured provider at unused loopback port 9106 exposed a classification gap: the AI SDK wraps refused sockets in a retryable `APICallError`, which had been rendered as generic “Something went wrong.” `toChatError` now maps retryable API errors without an HTTP status to the existing `connection_failed` envelope and troubleshooting guidance.
- The headed BrowserOS smoke verifies the side panel displays “Connection failed” and Retry for a refused local provider, then uses CDP to block the extension’s `/chat` request and verifies the Aster local-service message and Retry recovery after unblocking. The test-only dummy key is absent from both views; no external network or provider credential is used. The repeatable flow is `tests/e2e/aster_provider_offline_smoke.py`.
- Chat-error classifier and stream tests pass (28/28), full workspace typecheck and targeted Biome pass, the `ChatError` suite passes (10/10), and the updated headed smoke passes. Empty provider-selection UX and an actual stopped agent-server process remain unverified, so A13 stays PARTIAL.
- Legacy local fetch failures now tell the user that Aster’s local AI service could not be reached, with a retry action and no BrowserOS-branded help link.

### Phase 5 follow-up — local task detail timeline (partial)

- Added a Task History sidebar page with `/tasks` and `/tasks/:taskId` routes. It reads local execution history only after the browser window is confirmed non-incognito, lists status/time/counts, and shows task UUID, bounded response preview, and ordered tool-step timeline. Common credential-shaped prompts, results, tool names, and displayed step previews are filtered heuristically.
- The task record schema has no downloadable artifact descriptors, so the detail page reports that no artifacts are available and does not make links from tool text or paths. The detail view now shows the saved prompt, ordered step summaries (including safe approval/error detail), and full saved final response where available, falling back to the preview; raw tool inputs and outputs are not stored. Credential-shaped displayed records remain excluded. Focused task-history helpers pass (6/6), app typecheck and targeted Biome pass. Headed BrowserOS v0.51.0 smoke evidence above predates this transcript extension; no new headed UI run was performed. U16 remains PARTIAL.

### A05 follow-up — interrupted task visibility recovery (partial)

- Task History checks each distinct conversation with a locally stored `running` task against `/chat/:conversationId/state`. It creates idempotent task-scoped recovery markers only after HTTP 404; HTTP 200, server errors, and network failures create no marker. The UI overlays `interrupted` only while the matching stored task still exists and remains `running`, so terminal records and deletions take precedence. Markers use separate extension storage keys; recovery never rewrites the task-history object. No schema migration or transcript copy was added.
- Focused recovery tests pass (13/13 app; 23/23 server auth/chat route), app/server typechecks and targeted Biome pass. The headed disposable-profile recovery smoke and a true BrowserOS plus Bun sidecar SIGKILL/restart smoke both pass. The server's originless state-read exception is limited to headerless localhost extension GETs for `/chat/:id/state`; other chat routes continue to require trusted extension origin. This recovers task status visibility only: active streams, partial transcripts, and tool side effects are not resumed, and server run state remains in memory.

### A05 follow-up — persisted run lifecycle and interrupted transcript display (partial)

- Commit `df8b12994` adds migration `0020_add_conversation_run_state.sql` and a SQLite lifecycle store keyed by conversation/run IDs. It persists identifiers, status and lifecycle timestamps only. On server startup, rows still marked `running` are changed to `interrupted`; deleting a conversation removes its lifecycle metadata and conversation data.
- The app accepts `interrupted` as a terminal run state, fetches the saved conversation transcript, and keeps it visible without opening or attaching to a new stream. This is transcript display/recovery, not execution continuation: stream buffers, tool state/side effects, leases/ownership and approvals are not persisted, replayed or recovered.
- Focused validation passed: 63 server tests, 5 app conversation-run-client tests, app and server typechecks, and targeted Biome. The separate task-history visibility recovery was committed in `c0df2a4e6`; its 13 app tests, 23 server auth/chat tests, headed disposable-profile smoke, and BrowserOS plus Bun sidecar SIGKILL/restart smoke pass. Those runtime checks verify interruption visibility only, not lifecycle transcript recovery. See [A05 lifecycle evidence](evidence/aster-a05-lifecycle-2026-10-28.md).
- A05 remains PARTIAL. Next exercise the persisted lifecycle transcript display across a real process restart and verify terminal/deleted precedence, cleanup and the absence of automatic tool replay; continue the broader native/runtime gates separately. No stream/tool state, execution resume, ownership/lease or approval recovery is implemented.

### Security follow-up — filesystem path boundaries (partial)

- Audited the existing canonical path resolvers and tool integrations. Workspace read/write/edit/list/find/grep paths reject absolute inputs, traversal, and symlink escapes; browser-generated output reads require the dedicated output directory and, where configured, an output path registered in the current session.
- Focused resolver and tool tests pass (134/134) across `utils.test.ts`, `read.test.ts`, `write.test.ts`, `edit.test.ts`, `ls.test.ts`, `find.test.ts`, and `grep.test.ts`.
- Linux `filesystem_bash` now requires Bubblewrap and runs with user/PID namespaces, a writable bind of only the selected canonical workspace, read-only system runtime mounts, a minimal `/etc` set, a private `/tmp`, and an allowlisted environment. The host home and unrelated `/tmp` files are hidden. If Bubblewrap is missing or the selected root is unsafe, execution fails closed. Windows and macOS do not yet have equivalent confinement.
- Focused filesystem coverage now passes 151/151 (134 path/tool checks plus 17 Linux Bash checks), including outside-workspace read/write isolation, host environment isolation, Bun runtime availability for the service user, `/etc/shadow` concealment, fail-closed behavior without Bubblewrap, and rejection of filesystem-root workspaces; server typecheck and Biome pass. Filesystem helpers still have validation-to-use races, so S02 remains PARTIAL pending race handling and cross-platform policy review.

### Goal workflow update — 2026-10-27

- Read the full available specification/tracking Markdown before task breakdown. The full matrix, progress log, and supporting project docs were reviewed; the referenced master-spec source is absent locally.
- Follow [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md): many bounded subtasks covering all 72 matrix IDs, multiple GPT Luna medium agents as primary coding workers, and GPT Sol planning and independent review. Preserve dirty work, assign disjoint paths, verify each batch, and keep the overall Aster goal open.
- First dispatched tasks: T02a diagnostics reporter identity and T02b emitted-manifest regression/configuration documentation. Existing S05/Sentry changes remain uncommitted.

### S04 follow-up — source audit and next privacy boundary (partial)

- Source review found key-gated rather than consent-gated startup: app PostHog and Sentry initialize when their build values are present; server metrics and Sentry likewise initialize from inlined keys. Disabling default Sentry PII does not make this opt-in.
- App `track()` crosses into Chromium through `chrome.browserOS.logMetric`; chat feedback events can include prompt, response, and comment text. Native metrics have an independent sender, so app/server consent alone cannot establish a browser-wide telemetry opt-out. No real task data, credentials, or telemetry endpoint was used in this source review.
- The next implementation is a persisted default-off telemetry consent boundary, a visible privacy control, gating at app/server sender entrypoints, and removal of raw conversational content from analytics. Sol is defining disjoint app/server assignments. Network payload inspection, independent native telemetry controls, remote handling, and packaged behavior remain open; S04 remains PARTIAL.

### T20a follow-up — native build feasibility and product bootstrap (in progress)

- Rechecked this host: 14 GiB physical RAM, 29 GiB swap, 12 CPUs, and about 288 GiB free on the project filesystem. There is no Chromium source checkout. Physical RAM below the upstream recommendation is a resource risk rather than proof that a low-concurrency build is impossible; pinned build tooling supports `BROWSEROS_NINJA_JOBS=2` for a future supervised trial.
- Luna is implementing an Aster-owned build product and fail-closed resource selection, after Sol reviewed the native build code. GN/C++ currently accepts BrowserOS and BrowserClaw only and still needs an Aster branch. Product plumbing and a dry-run plan will not be reported as a built Aster binary. No source download, native build, installation, release key, or published feed has been created in this step.

### S05 follow-up — explicit reporter boundary and live identity checks (partial)

- Aster's default manifest explicitly declares `externally_connectable.ids: []`: omitting that field permits extension callers in Chrome. A configured, validated reporter ID is injected into both the manifest and the runtime diagnostics gate. The shared diagnostics package no longer trusts or probes the BrowserOS reporter implicitly; BrowserOS neo retains its explicit app-local reporter configuration.
- The server's default origin allowlist now contains only the stable Aster development identity. BrowserOS compatibility requires an explicit `BROWSEROS_TRUSTED_ORIGINS` entry. Tests use real Aster-origin fixtures; the composed API/CORS suites pass 31/31, diagnostics tests pass 10/10, identity helper tests pass 7/7, and the isolated emitted-manifest build gate passes 2/2. The full workspace typecheck passed at this checkpoint before the subsequent privacy integration.
- Headed BrowserOS v0.51.0 runs in fresh disposable profiles and a loopback-only namespace verified both default reporter denial and an explicitly configured fixture's successful diagnostics request, including `cached: false` and its exact fixture version. The runtime manifest/key-derived ID, rendered Aster home, extension API access, rejected BrowserOS/unknown origins, and rejected originless protected POST all passed. The existing A05 Task History recovery smoke passed under the new Aster identity, retaining the original running task record and a separate recovery marker; this was not another process-crash test.
- A rebuilt unpacked extension can retain an old active service worker in an existing profile: CDP's loaded script source lacked the configured ID while the rebuilt file contained it. Fresh profiles resolved the mismatch. The repeatable smoke checks the active configured worker and rejects cached diagnostics rather than accepting a stale result. The fixture and smoke live under `packages/browseros-agent/scripts/dev/`.
- [Recorded evidence](evidence/aster-identity-2026-10-28.json) contains only test IDs, booleans, and status codes, not system snapshots, provider data or credentials. The default bundle was restored, the final browser and supervisor exited normally, and the exact test processes were stopped. Release key custody, update infrastructure, product/reporter ownership and a native Aster package remain open; S05 stays PARTIAL / BLOCKED.

### T20a follow-up — Aster Linux product plumbing (partial)

- Added a distinct Aster product descriptor, registry entry, Linux package/launcher/desktop/icon paths, original Aster icon assets, and product-specific overlay. Product resource selection uses Aster-only names and has no implicit BrowserOS reporter or component fallback. Chromium attribution is preserved during product-name replacements.
- Aster supports Linux only in this descriptor. Guards cover direct configuration, ordinary planning and universal planning; a Sol review found that the initial universal branch bypassed the platform guard, and Luna added a regression fix. BrowserOS/BrowserClaw universal planning remains supported. Non-Linux Aster identifiers are explicitly unsupported placeholders, not provisioned release identities.
- Installed the build tool's exact frozen `uv.lock` dependencies into a private task-work virtual environment. The actual, unstubbed focused suite passes 106 tests across planner, products, resource sources, doctor and string replacements. Product listing succeeds. Aster's Linux source-mode dry run lists 13 steps with signing/upload disabled; `product doctor aster` intentionally fails with `no server bundle registered`.
- No native Aster binary, Chromium checkout/download, installer or release artifact exists. GN/C++ Aster support, native telemetry policy, server bundle, source CRX/onboarding providers and resource staging remain open. The dry run and descriptor tests do not prove that native compilation or packaging works.

### Execution policy update — 2026-10-28

- User approved Luna medium for routine implementation, Terra medium for difficult integration, and Sol for planning and independent batch/security review. Use compact task-specific handoffs, bounded ownership, and escalate repeated failures rather than repeating equivalent attempts. This supersedes the earlier Luna-only implementation rule; the full goal remains active and incomplete.
- Current batch closes privacy UI/state and real Bun route-boundary regressions, and fixes native product registry/debug-extension test regressions. Earlier headed UI evidence is provisional: changing route composition exposed a real socket-identity failure on sidecar restart, so a complete latest-build smoke is still required before recording the privacy milestone.

### T20a native patch batch — source validation only (2026-10-28)

- Added baked Linux Aster product flags, identity/profile/executable/state paths, Aster extension filtering, and gates preventing BrowserOS updater, remote extension config, reporter, sidecar resources/listeners, native custom metrics and crash upload from being used by baked Aster. These are source changes; no native browser binary was built.
- Sol reviewed the 19 changed patch mappings and found a blocking three-Boolean product assertion. Luna replaced it with an exactly-one sum check. An independent standalone C++ check extracted the actual assertion from the patch and verified all eight flag combinations: the three one-hot selections compile, all others fail. This validates that assertion only.
- Native patch doctor passes (422 patches / 38 features). Luna fixed the Python debug extension selector so BrowserOS/BrowserClaw retain their runtime-switchable union while Aster includes only its own extension, and updated the release registry expectations. The actual frozen-environment suite ran 1,330 tests successfully, with three skipped.
- Aster source CRX, onboarding resource provider, registered server bundle, Chromium checkout/build, packaged runtime and release identity/service provisioning remain open. The product doctor still deliberately fails closed for the missing Aster server bundle.

### GitHub source checkpoint — 2026-10-28

- Recorded the cost-conscious model policy and next execution order in `NEXT_STEPS.md`. All current Aster source and Markdown changes are included in the requested source checkpoint. This is not a complete/release-ready browser.
- T04 normal headed consent, cross-tab revoke, page reload and origin-denial checks pass with explicit isolated server/browser state and valid dummy telemetry configuration; state permissions are 0600. Workspace typecheck passes. Latest advanced harness still timed out waiting for initial OFF, so error/retry and sidecar restart gates remain open.
- The test harness initially omitted `BROWSEROS_DIR`; that run was stopped and its test-created consent file removed from the default directory. Subsequent evidence uses an explicit disposable override. No personal profiles or credentials were used for the headed browser fixtures.

### Model policy refinement — 2026-10-28

- User now requests Luna for the majority of implementation and Terra as the primary planner/judge/reviewer. Sol is reserved for exceptional unresolved cases only. This supersedes the earlier routine Sol planning/review policy; current implementation work continues.

### T04 development runtime verification — 2026-10-28

- Terra completed the headed checks with a fresh disposable BrowserOS profile and explicit disposable `BROWSEROS_DIR`: blocked revoke leaves canonical and peer consent ON, offline load exposes retry without mislabeling a normal window, retry restores the confirmed state, and a confirmed revoke updates both tabs. Sidecar restart preserves granted consent and UI state; a subsequent revoke and restart preserve OFF. The file mode is 0600 and originless/foreign requests return 403.
- The earlier advanced timeout was a test harness problem: it used an overly broad switch selector and could navigate before the extension was registered (`ERR_BLOCKED_BY_CLIENT`). Exact aria-label selection and a bounded DOM/navigation wait resolved it without application changes. Evidence is in `evidence/aster-privacy-2026-10-28.json`.
- Luna added a portable smoke client under `scripts/dev/aster_privacy_smoke.py`, with expected-state/restart validation options and caller-owned process lifecycle. Syntax/help checks pass; the already-verified headed run used the original harness. Test processes were stopped.
- S04 remains PARTIAL: this verifies the development extension/sidecar, not a native Aster package, remote telemetry processing/retention, or the broad provider/log-sink audit.

### Usage stop request — 2026-10-28

- User requested a commit/push of all work and updated next steps when usage reaches 5% remaining, followed by stopping. Account usage will be checked at batch boundaries; the goal will be paused at that condition rather than marked complete.

### Aster development server bundle — 2026-10-28

- Luna implemented distinct Aster server component/bundle paths and a Linux x64 local-only builder, with no BrowserOS CI telemetry defaults or OTA-feed fallback. The archive includes the pinned Bun 1.4.2 executable and checksum provenance plus migrations. Duplicate target options are rejected; Terra verified that the target gate matches the actual argument parser.
- Review exposed two runtime gaps: the compiled server ELF cannot serve as a Bun interpreter, and independent MCP output resolution still selected BrowserOS state. Luna added explicit resource-directory plumbing and a validated packaged Bun resolver, plus a shared product-state helper used for server readback and MCP writes. Compiled Aster uses ASTER_DIR/.aster and ignores BROWSEROS_DIR; legacy BrowserOS behavior remains.
- Full Python discovery passes (1,333 tests run, three skipped), with builder Bun checks 7/7, state checks 16/16 and filesystem checks 22/22. The filesystem regression uses an actual compiled fixture and Bubblewrap. Parent workspace typecheck passes. Product-definition doctor reports Aster healthy.
- Terra independently started the rebuilt artifact against disposable headless Chromium in a loopback-only namespace: health OK, CDP connected, telemetry off, state under ASTER_DIR and the poisoned BROWSEROS_DIR absent. Bun executes JavaScript and its checksum matches the recorded provenance. Processes were stopped. Evidence and limitations are in `evidence/aster-server-development-2026-10-28.json`; usage is documented in `ASTER_SERVER_DEVELOPMENT.md`.
- No native Aster Chromium binary or end-to-end packaged MCP output is verified. Extension/CRX and onboarding source producers, native sidecar launch integration and release provisioning remain open.

### Native extension development plan — 2026-10-28

- Terra confirmed that the existing source/prepared resource and native installer paths require a signed CRX. No matching private key exists for the fixed public development identity. `ASTER_NATIVE_DEVELOPMENT_PLAN.md` records a separately gated unpacked debug path through resource staging, GN, loader and readiness; it is not implemented or compiled. Release signing/update requirements remain unchanged.

### User-requested pause checkpoint — 2026-10-28

- User explicitly requested pushing all current work and the upcoming plan, then stopping. The overall project remains incomplete and is paused pending a resume request.
- Includes the local Aster onboarding producer/branding and source-provider wiring as a development checkpoint. Actual native Aster compilation, installer readiness and packaged launch remain unverified. The proposed unpacked debug extension integration is documented in `ASTER_NATIVE_DEVELOPMENT_PLAN.md`; it is not yet implemented.

- Onboarding checkpoint validation: local no-upload Aster archive, workspace typecheck, Biome and focused Bun descriptor checks pass. Component/source-resource tests pass (19). Default BrowserOS build passed before the final favicon plugin adjustment. Known remaining defect: emitted Aster favicon is still BrowserOS despite Aster visual branding. Direct prepared-resource test import encounters a circular import; complete discovery validation is recorded separately below.
- Final full Python discovery passes: 1,335 tests run, three skipped, including prepared-resource tests in discovery order. The direct-module circular-import limitation remains; native compilation is still unverified.


### Resumed source implementation — 2026-10-28 (GitHub-only session)

The user authorized resuming after the earlier stop checkpoint. GitHub branch head was verified to match `fd3e599103536db01fc35a43ab28233b5667e0d7` before edits. New commits on `feat/aster-linux-ui` address Vite pre-transform onboarding favicon replacement and product-specific emitted HTML assertions, add a direct prepared-resource import regression check, and introduce a read-only Aster Linux debug unpacked extension validator with negative tests. These are **source changes awaiting execution**, not completed onboarding/native tests or an installed browser. The isolated public-key-to-extension-ID calculation matches `oifdmombnijnaiocijiacjhajbnpdlhb`. The current GitHub tool session cannot inspect the user's local working tree or execute the repository's test/build commands; see [the precise verification commands and remaining blockers](evidence/aster-github-resume-2026-10-28.md). Phase T20a debug resource integration and native compilation remain **PARTIAL / NOT VERIFIED**. Maintain the existing feature statuses until actual runtime evidence is collected.


### Gated Aster native-development implementation — 2026-10-28 (source-only)

Following user authorization to continue without performing the test suite, GitHub source commits added `--aster-unpacked-dev` and planner/GN identity gates, Aster-specific WXT unpacked ZIP preparation with checksummed source-resource roles, native input staging and a guarded native asynchronous unpacked installer path. Aster server/icon copy operations and debug product isolation were added. All are committed to the feature branch; the local Omarchy checkout was inaccessible. **Status: CODE IMPLEMENTED, NOT COMPILED/TESTED/VERIFIED.** Do not promote B01–B10 or the Aster native integration tasks to PASS. Signed release custody and update service are still blocked; no native Aster binary exists as verified evidence. Details and candidate build command: [source-only checkpoint](evidence/aster-unpacked-integration-source-only-2026-10-28.md).


### Continued source implementation — 2026-10-28 (tests skipped per user)

Added isolated Aster WXT debug build selection; a native Linux build wrapper; user-scoped Omarchy desktop entry with isolated profile; a native GN debug catalog copy; a non-privileged application command palette and sidebar entry; a Linux CPU/RSS capture utility; and a versioned copy of the original 1,559-line master specification in `docs/`. All changes committed to `feat/aster-linux-ui`, but **no tests, TypeScript builds, GN generation, Chromium compilation, native launch or performance measurements were performed**. U10 becomes PARTIAL at the source level. O01, F01–F05 and all native/browser completion gates remain unverified. See [source development evidence](evidence/aster-source-development-2026-10-28.md). Real signing custody/update feeds, full functional Aside parity and runtime security verification are still open.


### Initial-load code-splitting source update — 2026-10-28

The extension app router now lazily loads 15 secondary views (settings, task history, scheduling, diagnostics, onboarding, chat and related screens). The home composer and root layout remain eagerly loaded, with an accessible Suspense fallback for secondary routes. This is a code-level startup optimization; **no bundle analysis, frontend build, visual verification or measured performance data exists for this change yet**. Keep F01–F05 NOT_STARTED/PARTIAL as already recorded; measure stock BrowserOS and Aster on identical hardware before claiming a benefit.

### Local continuation and integration verification — 2026-10-28

- Fast-forwarded the clean checkout through 66 remote commits to `179ef1eb3`. Both onboarding brands and the rebuilt no-upload Aster archive pass; workspace typecheck and actual unpacked-extension identity validation pass. Python discovery passes 1,345 tests, three skipped, including new development-mode rejection/staging coverage.
- Reviewed corrections cover native pin verification, declared GN extension outputs and debug-only complete Aster sidecar resource/startup integration. These remain source-level native changes pending GN/C++ execution. Dedicated pinned Chromium provisioning is underway.
- Evidence and explicit remaining gates: `evidence/aster-local-resume-2026-10-28.md`. The goal remains active/incomplete; release provisioning and native/runtime/performance acceptance remain open.
- Final independent staging review fixed root/ancestor symlink redirects before copy/delete/write; combined focused driver/staging/resource suites pass 28 tests. Native descriptor tests remain uncompiled.

- Development fixture smoke now passes command-palette keyboard/focus/Escape, lazy settings and Task History/sidebar/history navigation with server disabled and isolated profile/network. Pinned Chromium source/dependency provisioning completed at 155.0.8059.26 (`16c3e55476d3564bea713314b2fff638749ce3e6`); actual native build is next.

### Actual native bootstrap trials — 2026-10-28

- The jobs=2 pipeline now executes common/server resources, copied resources and unpacked extension staging. Fixed product-owned version lookup and bracketed font filenames with focused regressions. All 424 native patches applied successfully after repairing pinned-context/hunk errors and making retries idempotent.
- Linux sysroot is prepared. GN/autoninja now use adjacent depot_tools rather than depending on global PATH. Actual GN generation is exposing and driving further GN corrections; no C++ compile, binary, package or native runtime is verified yet. Detailed executed evidence remains in `evidence/aster-local-resume-2026-10-28.md`.
- Full-project GN generation now passes: 35,759 targets / 5,077 files, exit 0. The unused `enable_js_type_check` warning remains. No native compile or runtime acceptance is claimed.

### U10 current-window tab command palette — 2026-10-28

- Luna added real current-window tab search/activation alongside existing route commands. Tab data is queried only while open and cleared on close; stale async work is discarded. Selection rechecks current-window membership, reports stale/API failures, and guards duplicate keyboard activation and repeated-open races. No new permission, remote favicon request, persistent tab data or provider call was added.
- Terra reviewed and cleared the source changes. Five helper tests, app typecheck, Biome and a fresh WXT build pass. Headed BrowserOS development-fixture checks pass listing, filtering, shortcut/focus/Escape, idempotent reopen, exactly one activation on repeated Enter, active selected tab and closed dialog state. The timeout was a harness assertion on a retained, already-closed background dialog DOM node; corrected assertions pass without a product fix.
- The run used a disposable profile and local fixture pages; network namespace isolation was not verified. Fixture processes and test listeners are stopped. U10 remains PARTIAL for native/OS/full command-center acceptance. Evidence: `evidence/aster-command-palette-tabs-2026-10-28.json`.
- Native baseline `3fb17c5c6` began real C++ compilation with two jobs. The full build was deliberately interrupted to prioritize five changed product/server/loader/crash-reporter object targets; completed outputs remain reusable. That focused build is active and still resolving shared dependencies, with no native binary or target-completion claim yet. Frontend changes have not been copied into the active Chromium checkout.

- Native `browseros_product.o` now compiles successfully with the actual pinned compiler and generated Aster flags (exit 0). Server/loader/crash-reporter preflight and full linking/runtime remain open. Existing object outputs are preserved while prioritizing these checks.

### Requested full-scope handoff — 2026-10-28

- Matrix accounting: 72 features, two PASS (2.8%), 28 partial including one blocked, 42 NOT_STARTED. Thirty features (41.7%) have work recorded; no weighted code/effort completion percentage is established.
- User explicitly requests building all features even if the next agent cannot test them all. CONTINUATION_HANDOFF.md records full implementation scope, priority order, tool/build state and every feature; IMPLEMENTATION_PLAN.md retains the complete 95-subtask breakdown. Untested source work must be recorded honestly and must not be promoted to PASS.
- At the handoff checkpoint, actual server configuration and manager object preflight finished with exit 0 (2,556 actions). Alongside product.o, three requested Aster-related translation units compile; linking, remaining changed objects and runtime are still open. No build is left running by that finished preflight.

- Actual pinned compilation of `browseros_product_state.o` also passed (one action, exit 0). Product, product-state, server config and server manager objects are now verified compiled. Loader/crash-reporter compilation, linking, package creation and runtime acceptance remain open.

### Five-percent allowance pause — 2026-10-28

The configured account allowance reached 5% remaining. Per the user instruction, the complete source/docs checkpoint and next implementation plan are pushed, owned builds/tests are stopped and agents are complete. The goal is paused, not complete. Continue from CONTINUATION_HANDOFF.md on a resume request.


### Remote continuation: genuine sidebar/tasks and private handoff — 2026-10-28

Starting at checkpoint `3f701328392b03c4df1aab1f5f542c28aa2f1333`, the GitHub-connected session implemented resizable persistent width (U01 PARTIAL), live tab/bookmark/chat groups (U02 PARTIAL), and real recent local task statuses (U03 PARTIAL). The agent handoff now stages message/attachment/tab context with a short-lived one-use token and limits legacy tab ID lookup to the current browser window. No cross-window selection, guessed terminal task status, or leaked raw message in the URL is intentionally introduced. The existing sidebar conversation history, private-by-default window check, and credential-shaped execution-history filtering are reused.

A normal Git clone failed because the isolated workspace could not resolve `github.com`; files were fetched/updated through the authenticated GitHub connector. An isolated copy of the sidebar data helper passed strict global TypeScript 5.8.3 typechecking and three Node.js assertions. **No full WXT build, app typecheck, Bun tests, native Chromium compilation or headed runtime verification ran here.** The canonical matrix is now 2 PASS, 31 PARTIAL (including one blocked), 39 NOT_STARTED. Evidence and exact limitations: [2026-10-28 remote implementation checkpoint](evidence/aster-remote-implementation-2026-10-28.md). The complete project remains incomplete, with no verified linked native Aster binary or release.


### Additional display customization source batch — 2026-10-28

U09 (already PARTIAL) has theme/extension scale/reduced-motion controls using `AsterDisplaySettingsCard.tsx`, persistent `chrome.storage.local` settings, a bootstrap storage observer and CSS motion suppression scoped to Aster's document. The change does not affect website content or native Chromium zoom. Follow-up validation now passes: 2 display-settings helper tests and the app typecheck. Headed theme/scale/restart/accessibility, battery and CPU checks remain open. See [cloud batch evidence](evidence/aster-remote-implementation-2026-10-28.md).


### Browser sidebar, approvals and local task-export implementation — 2026-10-28

Committed a second feature batch: real bookmark tree folder paths, scoped tab pin/close actions, server-enforced approval for tab/history mutations, bounded/redacted inline approval details, and user-triggered local Markdown task reports with raw tool input/output omitted. Linux GitHub Actions [run 40682050699](https://github.com/puneetdixit200/brower/actions/runs/40682050699) **PASSED**: WXT extension typecheck, server typecheck, 12 targeted Bun tests and Biome formatting. No native compilation or UI acceptance is inferred. The 72-feature matrix currently contains **2 PASS, 32 PARTIAL including one blocked, 38 NOT_STARTED**; U17 now PARTIAL, while U02/U16/A06 remain PARTIAL. Release signing and all native/Wayland/security-performance acceptance gates remain open. See [batch-2 source and test evidence](evidence/aster-feature-batch2-2026-10-28.md).


## Source-only partial foundations across original 38 rows — 2026-10-28

Following the user's request to defer testing and implement as much of every NOT_STARTED feature as possible, this session committed actual Chromium API quick controls (selected-tab navigation/reload, recent downloads/history, session restore, private-window restrictions and explicit screenshots), model processing disclosure and first-run privacy guidance, human-owned MFA takeover, bounded queued agent prompts, source-aware research seeding, credential-tool catalog exclusions, local site recipes with staleness/CRUD, token-authenticated status/stop CLI, external read-only MCP scoping, a restricted disposable-profile developer REPL, idle-to-active schedule reconciliation, agent-run admission limits/429 responses, user-picked directory task export, Omarchy Ozone options, and numerical startup/CPU/RSS/tab-API benchmark tools.

**No tests, typechecks, native builds, GUI sessions, actual benchmark runs or security-release acceptance were performed on these source changes, at the user's explicit request.** The historical passing GitHub Actions run 40682050699 covers only the previous feature batch, not the new code. The matrix now has **2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED and 2 NOT_STARTED** (72 total). These PARTIAL updates are source-only and not proof of working or secure native features. The two remaining NOT_STARTED rows are R02 durable heartbeat continuation and P03 blind autofill. See [the detailed evidence boundary](evidence/aster-source-foundations-38-2026-10-28.md). The project remains incomplete and not releasable.


### Push-triggered CI and deferred-test boundary correction

The existing branch-scoped GitHub Actions workflow triggered automatically on an
intermediate source commit despite the user's instruction to leave testing until
later. [Run 40695175449](https://github.com/puneetdixit200/brower/actions/runs/40695175449)
reported extension typecheck PASS, server typecheck FAIL with one specific
TypeScript error in `credential-tool-filter.ts` (tool description may be a
function). That source error was subsequently fixed by narrowing descriptions
to strings, but **was not rechecked**. The workflow was then changed to
`workflow_dispatch` only to honor the requested deferred-testing policy.
Later source commits remain untested and may have additional compiler/runtime
issues. This historical CI result must not be reported as a passing check for
the new foundation batch. The existing earlier passing CI run covers only
previous source revisions.

### Fetched remote continuation and 3% stop — 2026-10-28

Fetched 125 commits to `8454a673d` and fast-forwarded the local feature branch. Initial checkout was clean, but root-owned directories caused a partial fast-forward. Each partial file was verified identical to the fetched branch, archived in task work, and restored before a successful fast-forward; three original root-owned directories were preserved as locally excluded same-parent backups. No user changes were overwritten. No tests were run on the newly fetched source.

User requests Terra as main model with at most five Luna medium subagents, Luna only for coding and review; no Sol or Terra subagent delegation. The account was already at 3% remaining, below the 5% stop rule, so this is a stop checkpoint. Matrix: 2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED and 2 NOT_STARTED. R02 and P03 remain NOT_STARTED. The project is incomplete.


## R02 heartbeat continuation and P03 credential boundary — 2026-10-28

- Current uncommitted app/server work adds task-versus-heartbeat selection, a per-job heartbeat conversation ID, persistence of heartbeat turns, and a fail-closed continuation check that permits a first run or a run after `completed` only. Failed, interrupted (`running`), unknown, or unavailable history does not auto-continue. App/server typechecks passed and 52 focused tests passed for this batch. Disposable SQLite fresh creation and v18-to-0019 upgrade checks passed, including retained legacy rows/defaults; `DbConversationStore` transcript persistence survived close/reopen.
- Follow-up fixed the database rewind fixture that had left 0019 columns behind. The expanded server suite passes 61/61 and server typecheck passes on rerun; an earlier intermittent TS2589 did not recur.
- A separate U02 sidebar slice adds nested bookmark-folder drill-down/back while retaining global search, restricting opens to HTTP(S), and preserving the private-window guard. An independent-review fix landed; six focused tests pass (6/6), with Biome and app typecheck passing. Native integration and headed browser verification remain pending.
- R02 is now PARTIAL, not complete. There is no in-flight tool replay, lease or ownership recovery, approval recovery, or restart acceptance. No native compile or browser test was run.
- P03 remains NOT_STARTED. The Aster-only Autofill patch denies direct `list`, `add`, and `fill` calls with `approval_unavailable` pending real browser-owned consent; it does not implement autofill. At this earlier checkpoint the native checkout had not applied the new changes; the later staging update below records their application and GN regeneration. Native compilation and browser testing remain pending.
- Matrix accounting is now 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED (72 total). See [R02/P03 evidence](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md). The overall goal and native/runtime acceptance remain incomplete.
- Next: inspect native checkout and live build processes; apply reviewed patches/resources through the pinned pipeline; compile Autofill and focused DevTools test targets; run the focused native test; then continue the two-job native build and launch. Live-check job-mode selection, separate task conversation behavior, heartbeat continuation after completion, fail-closed failure/interruption, persistence/restart, nested bookmark drill-down/back/search and private-window behavior, and Aster Autofill denials plus unchanged BrowserOS behavior. Implement a real browser-owned consent boundary before any P03 operation can be enabled. Continue the complete 95-subtask plan and remaining live feature tests.
- Use Luna medium for implementation, focused checks, and documentation, including independent review as requested. At 5% remaining allowance, checkpoint source/docs and exact process/next-step state, stop owned builds/tests/agents, push if that is the active user instruction, and pause; never mark the project complete at the usage threshold.

### Heartbeat missing-history fail-closed follow-up — 2026-10-28

- Tightened continuation eligibility: a missing prior run is a valid first heartbeat only if the job has no conversation ID. If a conversation ID is already saved but run history is absent, continuation now stops because completion cannot be established.
- Heartbeat helper tests pass 4/4. The focused `ChatService` file passes 18/18, including a synthetic-model SQLite integration that closes and reopens the database, verifies the heartbeat resumes the same saved transcript, and confirms ordinary scheduled tasks remain out of chat history. Independent review passed.
- Native staging has now been checked: the pinned Chromium checkout contains only the exact committed guard/test hunks applied to two existing dirty files, and reconstructed expected patched files byte-match. Aster Debug GN regeneration succeeded. The requested single-object Ninja target was unknown and no archive/browser-test binary was available, so no compile or browser test ran; no broad build was started. This is staging/GN evidence only. Interrupted execution replay remains unimplemented, alongside the lease/ownership and approval recovery gaps. R02 remains PARTIAL. See [R02/P03 source checkpoint evidence](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md).

### U16 transcript slice and P03 native staging update — 2026-10-28

- U16 now displays the saved prompt, ordered safe step summaries and full saved final response where available. The Markdown task-report injection issue is fixed; focused report/task-history tests pass 10/10 and the app typecheck passes. No headed UI run was performed after this change. Artifact descriptors, native download behavior and persistence acceptance remain open, so U16 stays PARTIAL.
- P03 remains NOT_STARTED. The native checkout now contains the exact Aster Autofill guard/test hunks and Aster Debug GN regeneration succeeded. Native compilation and browser testing are still pending. The guard continues to deny `list`, `add` and `fill` with `approval_unavailable`; this is not an autofill implementation or consent UI. See [the Actor Login API review](evidence/aster-p03-actor-login-api-review-2026-10-28.md).
- The future P03 design must use a browser-owned broker: bind the live `WebContents`, `Profile`, primary main-frame token and committed origin; keep credentials in native memory; require a fresh browser-owned selection/consent gesture; revalidate target, document and origin before filling; and return only coarse status. The Actor Login service's direct credential retrieval does not provide Aster's chooser/consent boundary. Do not expose credential metadata or inherit persistent Actor Login grants.
- At the time of this note, native compilation and browser-test completion were pending. The later native build checkpoint at the end of this file supersedes its object-compilation status; browser linking/runtime and focused live behavior checks remain open. Overall status remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED.

### Aster native build update — 2026-10-28

- Pinned Aster Debug GN regeneration succeeded. All 11 Aster server translation units compiled successfully (exit 0) via their exact extracted CXX commands: server config, manager, proxy, appcast parser, prefs, updater, utils, health checker, process controller, launcher, and state store. `browseros_extension_loader.o` (after the GURL fix), `chrome_crash_reporter_client.o`, and `devtools/autofill_handler.o` also compiled successfully.
- The focused DevTools browser-test object now compiles successfully (4,561,960 bytes). Its initial five API accessor diagnostics were in added patch hunks and were fixed using `BrowserWindowInterface::GetWindow`, `GetSessionID`, and `GetProfile`; overlay hash matches the patch and reverse-apply validation passes.
- The full server GN label expanded to 22,621 tasks, but that build was interrupted early. The successful extracted-command object builds are focused translation-unit evidence, not completion of the full server target.
- No `browser_tests` binary/link or browser binary was produced, and no browser test or runtime check was performed. Browser build/link, packaged launch and live-browser acceptance remain open. P03 remains NOT_STARTED because the compiled Autofill guard is not a credential-selection or consent implementation. A05 remains PARTIAL, and the overall project goal remains incomplete. See the [native build checkpoint](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md).

### R03 daily alarm reliability — 2026-10-28

- Daily schedules now use one-shot alarms rearmed for the configured local wall time, avoiding fixed 24-hour drift across DST. Alarm lateness uses the timestamp captured on listener entry, and stale alarms for disabled or deleted jobs do not run.
- If schedule storage is unavailable or daily rearming fails, a periodic reconciliation alarm retries rebuilding schedules; successful startup/reconciliation clears the retry alarm. The one-minute missed-run grace policy remains skip-without-catch-up, and overlap protection remains worker-local.
- Ten focused schedule tests pass, including delivery latency, unavailable storage, rearm failure, disabled jobs and UTC/New York DST boundaries. App typecheck and `git diff --check` pass; an independent Luna review found and verified the disabled-job guard.
- No browser sleep/restart, live timezone change, duplicate cross-context, or packaged native acceptance was run. R03 remains PARTIAL. See [R03 evidence](evidence/aster-r03-daily-alarm-reliability-2026-10-28.md).

### U07 provider/model/reasoning routing — 2026-10-28

- The provider selector now displays and searches persisted model and reasoning effort. Chat request construction carries the selected provider ID, while the server hydrates model and reasoning settings from that stored row.
- The server derives reasoning support from the shared `models.dev` snapshot for stored providers, overriding stale client flags. Unknown stored model IDs fail closed, including custom Azure deployment names; legacy inline requests without a stored row retain their supplied capability.
- Seventy focused tests pass across eight files; app/server/shared typechecks and Biome pass. Independent Luna review verified unknown Azure models do not activate `forceReasoning`, and the inline compatibility test remains covered.
- No headed model-switch or provider-runtime compatibility test was run. U07 remains PARTIAL. See [U07 evidence](evidence/aster-u07-provider-routing-2026-10-28.md).

### U09, U13, U14 and filesystem boundary follow-up — 2026-10-28

- U09 display settings now have two passing helper tests and a passing app typecheck. Headed theme/system changes, scale, reduced-motion, restart, accessibility, and repaint/performance checks remain open.
- U13 adds explicit-consent visible-tab capture, crop-to-composer staging, and LLM/ACP image attachment forwarding on message submit. The selected tab is activated and verified in its target window immediately before capture; a mismatch, cancellation, or capture denial produces no attachment. Ten focused tests pass with app typecheck and targeted Biome; independent Luna review found no remaining activation-race issue. Headed permission and browser acceptance remain open.
- U14 request-time context now resolves from the side panel's owner tab only. Missing or invalid owner IDs fail closed, while the active-tab fallback remains only for legacy conversation restoration. Ten focused owner/request tests pass with app typecheck and targeted Biome; independent Luna review found no cross-tab context leak. Streamed model receipt and native Aster acceptance remain open.
- The production WXT extension build now passes. Its default Node heap limit aborted once near 2 GiB; retrying with a 4 GiB heap completed the 5-entrypoint build in 24.8 seconds. Existing unresolved Geist URL and large-chunk warnings remain; no browser was launched from this artifact.
- U09 now has a CDP smoke harness at `packages/browseros-agent/scripts/aster_theme_smoke.py` for Light/Dark/System selection, emulated system-scheme changes, extension storage, and page-reload persistence. Python syntax/import checks, the two display-settings tests, and app typecheck pass. No Aster CDP runtime was available, so this harness has not run and provides no new headed evidence; full browser-process restart remains unverified.
- T06 Linux read/write/edit/list/find/grep now share a session-pinned workspace-root descriptor and resolve child paths with `openat2`, rejecting intermediate and leaf symlinks. The descriptor is opened before filesystem tool construction, shared across turns, and closed after active operations drain or construction fails. Find/grep preserve the workspace as their traversal and read boundary; the bounded read loop rejects file growth beyond grep's cap. Non-Linux resolution keeps canonical symlink containment; a simulated Darwin regression test covers outside file and parent symlinks. Filesystem, agent, and ChatService/ACP focused suites pass 452/452, with server typecheck, targeted Biome, and `git diff --check` passing. Independent Luna review found no remaining issue in this scope. A Bubblewrap probe could not bind `/proc/<server-pid>/fd/<fd>` due to permission denial, so `filesystem_bash` remains pathname-bound; non-Linux helpers also retain validation-to-use races. S02 stays PARTIAL pending those boundaries and packaged-runtime acceptance.
- T06 Bash follow-up now passes the pinned directory descriptor to Bubblewrap through Bun stdio slot 3 and binds `/proc/self/fd/3`. A regression renames the selected workspace, creates a replacement at its former path, and verifies Bash still sees the original device/inode. The filesystem, agent, ChatService/ACP and lifecycle suites pass 455/455; server typecheck, targeted Biome, `git diff --check`, and independent Luna review pass. This closes the Linux Bash pathname-replacement gap. Non-Linux path operations remain pathname-based with validation-to-use races, and packaged-runtime confinement is unverified; S02 remains PARTIAL.
- No native build, headed acceptance for U09/U13/U14, or browser-permission smoke was performed in this batch. Matrix accounting remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, and 1 NOT_STARTED (72 total). Continue the full 95-subtask plan; next prioritize non-Linux race-safe filesystem confinement and packaged sandbox verification, then headed checks for U09/U13/U14 and remaining feature rows. The full project goal remains incomplete.

### T05.1 permission-mode slice — 2026-10-28

- Added a permission selector independent of legacy Chat/Agent task mode. The server resolves legacy Chat to Read-only and legacy Agent to Guard. BrowserOS Read-only uses the server-issued read-only Browser MCP lease, exposes only filesystem read/list/search tools for a selected workspace, omits arbitrary custom MCP servers, and retains password-tool exclusions and Deny precedence.
- Full access remains unavailable in the UI and explicit forged requests receive HTTP 400. ACP Read-only requests fail closed because the current ACP runtime cannot restrict its workspace tools. Guard keeps existing workspace confinement and approval behavior; this slice does not implement per-action allow/ask/deny persistence or a wider Full-access capability.
- Verification: 57 focused server tests and 5 app request tests pass; server and app typechecks, targeted Biome, diff check, and independent Luna review pass. A route fixture emits a caught/mocked `createLease` TypeError during an accepted-provider test; it is unrelated to this change and the test completes successfully. No headed UI or packaged-browser acceptance was run.
- A09/T05.1 remains PARTIAL. Next define and implement persistent policy rules, finish provider semantics without widening ACP access unsafely, and verify UI/restart behavior; only implement Full when its filesystem and browser capability boundary is enforced. Then run the local side-effect fixtures and headed acceptance in T05.3/T20a. Current remote `aster/feat/aster-linux-ui` had no commits ahead of `a341bd20f` at fetch time.

### T05.2 persistent action policy — 2026-10-28

- Added a SQLite-backed per-action Allow/Ask/Deny catalog with operation-specific IDs, bounded optional expiry, trusted app-origin GET/PUT/DELETE routes, and a settings screen that reads the server's canonical catalog. Unknown IDs and malformed or oversized-expiry updates are rejected; policy state survives database close/reopen.
- AI SDK chat checks rules before tool execution and rechecks a pending approval against the current server-held tool/input before accepting it, so a stale Ask card cannot override a newer Deny. Read-only and immutable safety gates remain independent. ACP BrowserOS MCP calls now enforce Deny and fail closed on Ask/unknown actions. ACP native Write/Edit/Bash permission requests use saved policy; only recognized requests with saved Allow receive `allow_once`. ACPX filesystem/terminal callback capabilities are disabled, Codex no longer receives a full-access startup override, and unknown or mismatched tool-name/kind pairs reject.
- ACP permission callbacks depend on the agent emitting ACP permission requests. They are protocol controls rather than an OS sandbox; direct filesystem or shell access by a custom ACP executable that avoids the permission protocol is outside this boundary. No packaged ACP runtime or headed settings screen was tested. Full access remains unavailable; ACP Read-only remains rejected.
- Verification: 47 focused server policy/API/MCP tests, 30 ACP runtime/policy tests, 5 provider tests, and 4 app response tests pass (86 total). App, server, and provider typechecks pass; targeted Biome and `git diff --check` pass. Independent Luna review confirmed the built-in mediated path and identified the custom-process sandbox limit above.
- A09/T05 remains PARTIAL. Next run T05.3 local send/post/payment fixtures, add headed settings and policy behavior checks, verify real ACP permission requests in a packaged Aster runtime, test rule persistence across full app/server restart, and continue all other MUST items and native gates. Matrix remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED (72 total).

### T05.3 local send/post/payment approval fixtures — 2026-10-28

- Added deterministic local send, post, and payment fixtures through the production ToolLoopAgent approval callback. The production callback and local fixtures share the same approval path; the tests use no network or credentials, and only the explicitly approved fixture executes.
- Verification: focused fixture tests pass 3/3 with 15 assertions. A09/T05 remains PARTIAL pending headed settings behavior and policy persistence across a full restart, plus packaged Aster/ACP runtime acceptance on T20a, including real built-in ACP mediated requests. ACP permission callbacks remain protocol controls, not an OS sandbox for arbitrary custom processes.
- Completion remains 2/72 features PASS (2.8%); source fixtures do not establish headed or packaged-runtime acceptance.

### T07.1, R02/R03, and O04 source follow-up — 2026-10-29

- P01/T07.1 filters credential-shaped names/descriptions across the combined internal MCP, external MCP, filesystem, and nudge tool catalog. It also removes exact `run` and `evaluate` tools from the internal BrowserOS catalog before merging connectors, preventing model-facing raw page JavaScript/CDP access; `snapshot` and `read` remain. Four focused catalog/request tests pass (33 assertions), including production `AiSdkAgent.create`. Server typecheck and targeted Biome pass. A proposed snapshot guard relying on AX `protected=true` was removed after review showed the pinned protocol does not emit that property. Pinned Chromium source masks password values in AX unless a setting is enabled; the renderer enables it only on Android. This is source inspection, not linked Aster runtime proof. Screenshot, standalone MCP, connector, and packaged-browser boundaries remain open. P01 remains PARTIAL.
- R02/R03 now have an authoritative SQLite partial unique index permitting one `running` record per job. Same-run start retries are idempotent; a competing run returns 409. Migration 0022 and packaged fallback fail duplicate legacy running rows before enforcing the index. Independent Luna review identified a retention edge where a timestamp-sorted prune could delete an old active claim; pruning now excludes all `running` rows from the terminal-history cap. The regression proves the claim survives with 15 newer terminal rows and still rejects a competing run; run-store tests pass 10/10 (20 assertions), server typecheck and targeted Biome pass. Headed alarm/restart and packaged Aster acceptance remain open; the lock prevents overlap but does not resume a crashed run. R02/R03 remain PARTIAL.
- O04 installer tests now cover ownership markers, symlink refusal, unowned icon preservation, failure without partial icon mutation, and unchanged fixture Hyprland/default-browser files. Five standard-library tests and Python syntax compilation pass. Independent Luna review found no remaining concrete ownership/deletion issue. No linked Aster package was installed on the Omarchy desktop, so O04 remains PARTIAL.
- Git fetch found no new commit on `aster/feat/aster-linux-ui`; only an unrelated Dependabot ref was force-updated. The adjacent Chromium checkout remains detached with extensive pre-existing dirty Aster changes and was preserved. A native build/dry-run probe encountered a Ninja log-version mismatch; the `.ninja_log` was subsequently absent while `.ninja_deps` and compiled objects remained. No native source files changed. Preserve the output directory; do not rewrite logs, regenerate GN, or restart the build until a compatible Ninja and log location are identified. `uv` and `pytest` are absent from the current system Python environment; six standard-library native staging tests pass, but the broader resource pytest suite is unverified.
- Matrix accounting remains 2/72 PASS (2.8%); do not promote source-only work to full feature acceptance. Detailed evidence and next gates: [`aster-t07-r02-o04-source-2026-10-29.md`](evidence/aster-t07-r02-o04-source-2026-10-29.md).

### P01 credential-catalog follow-up — 2026-10-29

- Extended credential-export metadata matching to include standalone account PINs, PIN codes, security-question answers, and question responses; added view/inspect verbs and direct-object display matching while retaining benign warning and tab-pinning tools. The filter remains a defense-in-depth heuristic.
- Three focused catalog/request tests pass 3/3 (17 assertions), including a test through `AiSdkAgent.create`; server typecheck and targeted Biome pass. Real provider, non-tool connector data paths, native password paths and packaged-browser acceptance remain open. P01 remains PARTIAL.
- GitHub fetch found no new feature-branch commits. All accumulated changes remain local and uncommitted; full batch regression and final `git diff --check` are still pending.

### U03 Recent Tasks composition coverage — 2026-10-29

- Extracted the recent-card composition into `apps/app/screens/newtab/index/recent-tasks.ts`; the new helper reuses shared marker application and execution-history flattening/redaction, then applies the three-card cap. `RecentTasks.tsx` retains storage access, marker validation, change subscriptions, and the private-window gate.
- Focused helper tests pass 2/2 (4 assertions) for task/conversation/running-state marker matching, stale/mismatched markers, credential-shaped prompt filtering, newest-first ordering, and the cap. App typecheck and targeted Biome pass. Independent Luna review found no actionable issue and reran the recent-task/task-history helper suite (9/9, 12 assertions). This is source-level coverage only; U03 remains PARTIAL pending headed Aster persistence/private-window UI acceptance and full transcript/restart recovery verification.

### U15 restart harness and U17 approval accessibility — 2026-10-29

- Added `packages/browseros-agent/scripts/aster_sidepanel_draft_restart_smoke.py`. It owns a fresh temporary BrowserOS profile/process, restores two local owner tabs and two attachment tabs, resolves post-restart tabs by unique fixture URLs rather than assuming session tab IDs are stable, and checks each draft and attachment plus owner isolation. Static Python compile and `--help` pass; no native Aster binary was available for a live run. Current app storage is keyed by session tab ID and therefore cannot guarantee correct owner/attachment restoration across restart. U15 remains PARTIAL until this source gap is fixed and the harness passes on Aster.
- Independent Luna source audit confirmed the gap: `SessionTabHelper` constructs a new `SessionID::NewUnique()` after restore. Session restore serializes tab `extra_data` through `SessionService::AddTabExtraData` and rehydrates it in `CreateRestoredTab`; the current BrowserOS extension API exposes no stable tab identity. This is a concrete implementation path, not a completed fix: add a native opaque GUID to tab extra data, expose GUID lookup/resolution to the extension, migrate legacy numeric records only when their same-session live tab is known, and test duplicate URLs, stale attachments, OTR and PRE_/restart restore. The actual browser checkout remains dirty and was not modified.
- U17 approval controls now use a keyboard-operable native disclosure button, labeled fieldset/legend and description, a pending status announcement, and action-specific Approve/Deny names. The denial callback is tested. Combined focused RecentTasks, approval-preview and ToolBatch tests pass 8/8 (24 assertions); app typecheck, targeted Biome and `git diff --check` pass. Headed accessibility, timeout, and native acceptance remain open; U17 remains PARTIAL.
- A fresh fetch found no new commits on `aster/feat/aster-linux-ui` (local and remote feature refs are identical). Upstream `origin/main` advanced independently and remains unmerged. All current source and documentation work is local and uncommitted. Matrix remains 2/72 PASS (2.8%); refresh usage at checkpoints and follow the user's commit/stop rule only at 5% remaining.

### P02/P04 human login handoff — 2026-10-29

- Extracted the tab-selection and takeover ordering into a focused helper. It calls stop before the first browser query, queries only the current window, and activates only a current HTTP(S) tab already attached by the user. No login/password/code value is accepted or forwarded by the helper.
- The UI now distinguishes a missing attached tab or failed activation, explains that the stopped run will not resume or replay, and tells the user to submit a new prompt for any further agent action. The close button dismisses the notice only. Tests pass 3/3 (7 assertions); app typecheck and targeted Biome pass. No headed password-manager, MFA, CAPTCHA or passkey login was performed; P02/P04 remain PARTIAL.

### A12/T26.2 fresh-turn continuation — 2026-10-29

- After user-triggered Stop and takeover, “Continue after I’m done” sends a fresh user turn in the same conversation. It validates attached tabs against the live current window and otherwise targets the live active HTTP(S) page. For this continuation only, browser context retains tab IDs but omits active/selected tab URLs and titles. The fresh prompt asks the agent to inspect current state and not repeat the stopped action or request/include login secrets; this is advisory and not enforced. This metadata filter does not establish that all downstream page-derived content is excluded. Refused sends show retry guidance; accepted sends are described as sent or queued. Focused handoff and request-context tests cover prompt semantics, stale-tab fallback and metadata omission. Automatic challenge detection, same-run pause/resume, the dummy local challenge flow and headed acceptance remain open.


### P01 standalone and agent MCP catalog boundary — 2026-10-29

- A shared product-specific Browser MCP catalog now removes exact `run` and `evaluate` tools for Aster builds while preserving the BrowserOS catalog. Aster-specific MCP instructions no longer tell agents to use raw page-code execution or proceed with provided login credentials; BrowserOS instructions remain unchanged. The same filtered catalog is used by BrowserMcpModule (agent and standalone `/mcp`) and `/mcp-manager/tools`, keeping discovery consistent. This intentionally also excludes raw page-code/CDP execution from Aster internal MCP agents.
- Verification: 37 focused tests pass across credential catalog/request, MCP catalog/module and manager service suites (116 assertions), with two additional Aster prompt-selection tests (7 assertions). Targeted Biome and `git diff --check` pass. No native runtime or real-provider test was performed. Screenshot and connector data paths, native password-manager behavior, and sentinel-value checks remain open; P01 remains PARTIAL.
- The latest completion figure remains 2/72 fully verified features (2.8%). A targeted fetch of the Aster remote found no new feature-branch commit; full `git fetch --all --prune` timed out against upstream `origin`. Current source and docs remain local and uncommitted. Usage is 19% primary and 32% weekly used, well above the user's 5%-remaining commit-and-stop threshold.


### GitHub refresh and T06.2 POSIX FIFO hardening — 2026-10-29

- `git fetch aster --prune` found no new Aster feature commits; local and remote `feat/aster-linux-ui` remain at `91f0e1865`. Fetched `origin/main` at `02291b424`; it remains unmerged because it is substantially divergent from this Aster branch. All pre-existing local source and documentation changes were preserved.
- POSIX leaf opens now add `O_NONBLOCK` and `O_NOCTTY` when available. A FIFO test confirms an `openPosixRelative` caller that omits `O_NONBLOCK` does not hang. Verification: safe-file suite 16/16 (43 assertions), complete filesystem suite 177/177 (386 assertions), server typecheck, targeted Biome and diff check pass. Independent Luna review found no correctness regression.
- This only closes the FIFO-blocking case. Portable POSIX still cannot atomically reject a raced device node before opening it; device-specific open-time effects may happen before the descriptor check. T06.2 and S02 remain PARTIAL, as do the native macOS/BSD and packaged Aster gates. Matrix remains 2/72 PASS (2.8%). Latest usage check: 41% primary and 36% weekly used (59% and 64% remain), above the user's 5%-remaining commit-and-stop threshold.


### T28.3 M06 persisted site-recipe validation — 2026-10-29

- Site recipe loading now rejects malformed JSON, unexpected fields, malformed/duplicate IDs, invalid or noncanonical origins, credential-shaped or oversized text, invalid timestamps/order, and more than 150 records. Direct saves enforce the same field bounds and credential checks. Save/verify mutations remain readable when accepted timestamps are up to five minutes ahead of the local clock; repeated trailing dots and malformed DNS labels are rejected.
- Focused site-recipe tests pass 4/4 (85 assertions), covering persistence/reopen, staleness, malformed entries, duplicate IDs, unsafe origins/text, and bounded clock skew. Server typecheck and targeted Biome pass. Independent Luna review found no remaining findings in the two corrected edge cases.
- `bun run test:lib` reports 233 passed and two PostHog transport tests failing because the expected SDK methods `getPersistedProperty` and `flush` are absent in that group-run context. The focused PostHog transport file passes 4/4 when run alone. This unrelated suite issue remains unresolved. Public DNS names may still resolve privately or rebind; no DNS resolution guarantee is made. Native route/UI, private-window and packaged restart acceptance remain open; M06 remains PARTIAL. The test is under writable `apps/server/tests/lib/site-recipe-store.test.ts` because the existing `tests/lib/memory/` directory is root-owned.


### T03.2 shutdown route boundary — 2026-10-29

- Both `/system/shutdown` and `/shutdown` now require a loopback peer, an exact `localhost` or `127.0.0.1` Host authority with an optional numeric port from 1 through 65535, and an explicitly allowed Origin when Origin is supplied. Originless loopback shutdown remains compatible with shipped BrowserOS C++ restarts. Non-loopback peers, forged/malformed hosts, invalid ports and attacker Origins return 403 without invoking the shutdown callback.
- Direct and composed route tests pass 25/25 (127 assertions); server typecheck, targeted Biome and `git diff --check` pass. Independent Luna review confirmed the boundary and valid/invalid port behavior. This does not authenticate other local processes, which can still make a loopback originless request. S03 remains PARTIAL pending the broader control-plane and packaged-runtime audit.


### T16.1 command-palette shortcut decision tests — 2026-10-29

- Extracted the platform-aware palette shortcut predicate and wired it into the app listener. Ctrl+Alt+K is accepted on Windows/Linux and Meta+Alt+K on macOS; repeated events, Shift, both/no primary modifiers, other keys and onboarding are rejected.
- Twelve focused predicate tests, app typecheck and targeted Biome pass. Existing tab helper and headed BrowserOS tab activation evidence remains separate; native OS/browser shortcut conflicts are unverified, so U10 stays PARTIAL.


### T23.1 stop-time transcript mutation guard — 2026-10-29

- `ConversationRuns.updateMessages` now rejects late callbacks after explicit stop, terminal completion/failure, or run replacement, while preserving the already-published partial transcript. Added a regression for a late provider/onFinish update after stop.
- Focused `conversation-runs.test.ts` passes 14/14. Independent Luna review checked initial history, final onFinish, ACP setup/finish/catch, stop abort ordering, and replacement behavior; it found no lost legitimate final messages. Targeted Biome, `bun run typecheck`, direct TypeScript checking, and diff check pass on rerun; an earlier concurrent check emitted an unlocated TS2589. Browser-action/runtime cancellation acceptance remains open, so A04 remains PARTIAL.


### P01 screenshot/AX boundary and A05 exact run identity — 2026-10-29

- Task History now persists the server-issued run ID from `X-BrowserOS-Run-Id` before the chat transport consumes the response stream. The server exposes that header through CORS. `/state` reconciliation requires exact conversation/run-ID equality for terminal status, while 404 recovery, terminal/deleted precedence and per-task history updates remain intact. Verification: execution-history recovery/run-ID 22/22; server chat/run/CORS 57/57; app and server typechecks plus targeted Biome passed. No transcript replay or execution resumption was added; A05 remains PARTIAL.
- TypeScript and Rust screenshot paths now install a temporary field mask before capture, fail closed on incomplete masking, mask form/editable text and placeholders, hide inaccessible frames, detect closed shadow roots, and attempt cleanup on failures. TypeScript MCP and Rust MCP post-action capture use the masked Browser screenshot API. Aster's TypeScript MCP catalogs continue to exclude raw `run`/`evaluate`; the shared Rust MCP crate has no trusted Aster identity, so its raw CDP behavior was not globally changed. Verification: 7 TypeScript screenshot/password-boundary tests, 5 Rust core screenshot tests, 3 Rust MCP capture tests; Browser-core/MCP typechecks passed. A separate Luna review found no remaining Aster catalog route to raw CDP.
- Both AX snapshot renderers omit AX values. The typed Rust view also omits AX values from model-facing controls, strips link URLs, keeps value-change sensitivity in the control guard, maps renderer references to the capture refs and drops unmapped refs. Focused Rust view tests pass 52/52 using Chromium's bundled Rust toolchain. App history/download tests pass 48/48; recent-task/login/shortcut tests 17/17; artifact route/filesystem tests 12/12; credential/MCP catalog tests 8/8. The tests use focused fixtures and mocked protocol responses; no real Chromium pixel test, native Aster package, or Autofill acceptance was run.
- Independent screenshot review noted the mock-only limit; arbitrary custom connector outputs remain guarded by tool-metadata heuristics rather than guaranteed scrubbing. P01 and A05 remain PARTIAL. `aster/feat/aster-linux-ui` had no incoming commits; upstream `origin/main` was fetched at `02291b424` and left unmerged. Work remains local and uncommitted. Matrix stays 2/72 PASS (2.8%). Latest usage: 39% primary and 36% weekly used, so the user's 5%-remaining commit-and-stop threshold has not been reached.

### P01 connector-output redaction follow-up — 2026-10-29

- Added a best-effort sanitizer for remote Klavis/Strata tool results before AI model and registered MCP outputs. It masks common secret-named fields and credential-labelled text, omits remote image blocks that cannot be inspected safely, and preserves benign `*_count` metadata. The dedicated `connector_mcp_servers` authentication URL path is unchanged.
- Focused Klavis service tests pass 10/10, including redaction, image omission, useful-field/count preservation and auth URL behavior. Server typecheck, targeted Biome and `git diff --check` pass. Independent Luna review found no remaining actionable issues in this slice. This pattern-based sanitizer cannot guarantee detection of unlabelled secrets; no live provider acceptance was performed. P01 remains PARTIAL and the matrix remains 2/72 PASS (2.8%).


### U18 privacy walkthrough and T14.2/U08 processing disclosure — 2026-10-29

- U18 now gates provider setup behind four sequential first-run checkpoints covering provider routing, page/context sharing, Chromium permission boundaries, and keeping credentials in native login flows. The existing provider-add, default-target and `/home` handoff callbacks remain connected after the final acknowledgement. Focused helper and rendered-gate tests pass 5/5; combined focused UI tests pass 13/13 (56 assertions). App typecheck, targeted Biome and `git diff --check` pass, and `NODE_OPTIONS=--max-old-space-size=3072 bun run --cwd apps/app build:dev` succeeds after the final UI changes. The build reports existing unresolved-font, Rollup annotation and large-chunk warnings. Import flow, actual profile-location and native permission steps, and headed fresh-profile/restart acceptance remain open; U18 is PARTIAL.
- T14.2/U08 now renders the existing selected-provider processing disclosure at home, new-tab and side-panel send surfaces. Independent review caught and fixed a new-tab caller that would have shown “No model connected” despite a saved provider. Eight focused disclosure/caller tests pass (19 assertions), including no-provider, ACP, Ollama/LM Studio remote-endpoint caution, OpenAI-compatible, cloud-backed and selected-provider plumbing. The full focused U08/U18 set passes 13/13 (56 assertions), with app typecheck, targeted Biome and diff check passing. Actual request routing, provider retention/outbound traffic and headed acceptance remain unaudited; U08 and S04 remain PARTIAL.

### T18.1 optional Chromium import handoff — 2026-10-29

- U18 adds an optional, user-triggered handoff to Chromium's `chrome://settings/importData`. The import choice remains Chromium-owned; native setup owns the profile location and the extension cannot change it.
- Focused onboarding suites pass 6/6 (53 assertions); app typecheck and targeted Biome pass. Headed native Aster acceptance has not run. U18 remains PARTIAL; matrix status remains 2/72 PASS (2.8%). Next verify this flow in a disposable headed Aster profile when a runnable binary exists.

### T26.1 research source-contract and UI ledger — 2026-10-29

- Successful built-in Browser MCP `read` results now include the current page URL in structured output; `navigate` already returns a structured URL. After the research answer, the accessible “Source URL checks” ledger classifies HTTPS citation URLs from that answer against successful `read`/`navigate` structured outputs inside the current research turn. It ignores model prose as visit evidence and never sends observations back to the prompt builder.
- URL matching preserves query strings and path case while ignoring fragments, so distinct query pages remain distinct. A sanitized attached seed is `seed-only` only when its normalized URL exactly matches; seed submission removes queries/fragments and drops sensitive-looking paths to the origin, and ledger display also omits queries and sanitizes sensitive paths. These filters are heuristic and cannot guarantee all secrets are removed. A matched URL confirms only that a tool returned that URL; it does not establish factual claim support.
- UIMessage tool parts do not encode MCP server identity. Attribution depends on the server-side reserved-name collision filter, and a production regression verifies custom MCP tools named `read`/`navigate` cannot replace built-ins. Research-request, source-ledger and Browser MCP read tests pass 17/17 (38 assertions); the production collision regression passes 1/1 (3 assertions). Successful citation URL matches now display whether the built-in `read` or `navigate` tool observed them in the same research turn. This proves URL observation only, not factual claim support. App and Browser MCP typechecks, targeted Biome and `git diff --check` pass. No live-provider verification was run. A11 remains PARTIAL; next add claim-to-source evidence and verify with a live provider.
- `git fetch aster --prune` found no incoming feature-branch commits; local `HEAD` and `aster/feat/aster-linux-ui` remain `91f0e1865`. The broad existing dirty tree is preserved, and upstream `origin/main` remains unmerged. The matrix remains 2/72 fully accepted features (2.8%); partial source work is not promoted to PASS. Latest account usage check: primary 51% used and weekly 37% used (49% and 63% remain), above the user's 5%-remaining commit-and-stop threshold.


### T03.1 control-plane listener inventory — 2026-10-29

- Added [`evidence/aster-t03.1-control-plane-source-audit-2026-10-29.md`](evidence/aster-t03.1-control-plane-source-audit-2026-10-29.md), a source-only inventory of the legacy TypeScript API/MCP routes, BrowserOS neo Axum API/MCP, OAuth callback listener, stdio MCP, and repository-visible CDP/proxy launch configuration. It records authorization/origin boundaries, mutating surfaces, and exact package/runtime evidence still required.
- The inventory found that BrowserOS neo MCP and sensitive neo APIs rely primarily on a loopback boundary in inspected source, OAuth callback `/cancel` is method-agnostic and unauthenticated beyond its loopback bind, and the inspected agent source does not prove Chromium CDP/proxy bind or Authorization forwarding. A separate Luna source trace established that the Aster descriptor intends the legacy TypeScript `aster_server` sidecar and does not select neo; native patch files and release resources still need build/package proof. Independent Luna review corrected and rechecked the OAuth error-callback/state wording, unauthenticated TS `GET /mcp` scope, neo MCP transport methods, and the source-selected Aster process. This is not a vulnerability validation or packaged test; S03 remains PARTIAL.
- No source code or adjacent Chromium checkout was changed. The inventory's own `git diff --check` passed; route tests were not rerun because this was a read-only source audit.


### Current continuation — P01 redaction and T31.3 dev REPL — 2026-10-29

- `git fetch --all --prune` found no new commit on `aster/feat/aster-linux-ui` (`91f0e1865`); upstream `origin/main` advanced from `02291b424` to `0f7ead670` and remains unmerged. The existing broad dirty tree and adjacent Chromium checkout are preserved.
- P01 connector-output sanitization now removes complete raw Cookie/Set-Cookie header lines, recursively redacts valid JSON text fields, masks multiline PEM private-key blocks, and removes complete Basic/Digest/Bearer Authorization values in addition to common labeled secret values. Focused Klavis service tests pass 11/11; arbitrary unlabelled secrets and live-provider behavior remain unverified, so P01 remains PARTIAL.
- T31.3/D03 now has a pure command-validation/dispatch seam and source tests for the tab-action allowlist, HTTPS URL and target validation, loopback/ephemeral CDP binding, private profile permissions, EOF cleanup, timeout escalation, and cleanup when the Chromium leader exits before descendants. The focused developer-REPL suite passes 8/8. No native Aster REPL session or normal-profile isolation test ran; D03 remains PARTIAL.
- `IMPLEMENTATION_PLAN.md` now tracks 103 unique subtasks, including eight master-spec coverage units. The matrix remains 2/72 PASS (2.8%); the overall goal is incomplete. Latest account usage was 56% primary and 38% weekly used (44% and 62% remain), above the user's 5%-remaining checkpoint.


### Resume checkpoint — fetch, P01 redaction and T19.4 trace integration — 2026-10-29

- `git fetch --all --prune` found no new commit on `aster/feat/aster-linux-ui` (`91f0e1865`). `origin/main` advanced from `0f7ead670` to `7a032719e` with an upstream MCP action-settle change; it remains unmerged. Preserve the broad source worktree and the adjacent 319-path dirty Chromium checkout.
- P01 connector redaction now covers common sensitive keys with repeated suffixes such as `passwordValueText` and `accessTokenValueEncoded`; nested object and serialized JSON regressions confirm the secret sentinels disappear while count fields remain. Focused Klavis tests pass 11/11, Biome and diff checks pass. Arbitrary unlabelled secrets and live provider responses remain unverified; P01 stays PARTIAL.
- At this earlier checkpoint, T19.4 generated schema-validated task/tool/approval/terminal events in memory; that storage status is superseded by the T19.4 durable integration follow-up below. Live-provider/package behavior remains unverified; A01–A09 remain PARTIAL.
- This resume reran 49 app recovery/task-history/recent-task tests, 12 processing-disclosure/onboarding tests, 2 artifact-download tests, 7 site-recipe/artifact tests, and 8 dev-REPL tests; all passed. App typecheck passed. The development extension build passed with `NODE_OPTIONS=--max-old-space-size=3072`, producing 24.1 MB after the default Node heap aborted at about 2 GB; unresolved-font, Rollup annotation and large-chunk warnings remain.
- A read-only native audit confirmed there is no linked `chrome`/`browser_tests` binary, `.ninja_log` is missing, and the dirty native checkout has focused objects plus generated Aster GN state. The in-tree Ninja is 1.12.1, the depot_tools wrapper cannot start, and 5.8 GiB RAM was available with 14 GiB swap in use. Preserve GN/build outputs; next determine whether a bounded in-tree Ninja action can reuse current objects before any native build.
- The matrix remains **2/72 PASS (2.8%)**; no feature was promoted from source/test evidence. Latest allowance: 62% primary and 39% weekly used (38% and 61% remain), above the user's 5%-remaining commit/push/stop threshold. No commit or push was made.


### T19.4 durable trace store follow-up — 2026-10-29

- The lifecycle store exposes typed `appendTraceEvent(conversationId, runId, event)` and `getTraceEvents(conversationId, runId)` APIs. Migration `0023_add_conversation_run_trace_events` and the packaged-schema fallback persist strict `AgentTaskTraceEvent` metadata, validate on write and read, retain at most 500 events per run and 10,000 total, and delete trace rows with conversation cleanup. Migration `0024_add_conversation_run_trace_degradation` separately persists the degraded-storage marker. Both retention caps also apply when recovery inserts the interruption event.
- `ConversationRuns` persists schema-created lifecycle events through the durable store and revalidates stored events scoped to the recovered conversation/run when building snapshots. Recovery normalizes orphaned `running` status to `interrupted` and transactionally/idempotently persists one interruption event. Snapshots expose `tracePersistenceDegraded` when trace storage fails, while task execution continues unchanged. `AiSdkAgent` validates versioned call/result envelopes around tool execution with local call IDs; raw input/output pass through unchanged and are excluded from trace persistence. Latest root-verified results: server 78/78 across seven suites; app 81/81; browser-core/MCP 25/25; server route group 92/92; Python 13/13. App typecheck/build passed (24.1 MB); server typecheck/direct tsc, Biome and diff-check passed. Independent Luna review found no remaining T19.4 issue.
- No process-restart, live-provider, native-browser or packaged-runtime verification was performed. A05 and A01–A09 remain PARTIAL. The feature matrix remains **2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED (72 total; 2.8% PASS)**. No feature was promoted from source-only evidence.

### Latest focused Python and native-build probe — 2026-10-29

- Prepared-resource/unpacked-extension Python tests pass 14/14. Native pin/staging, Dev REPL and launcher Python tests pass 19/19, for 33/33 across those suites. Latest application and T19.4 verification remains: server 78/78 across seven suites, app 81/81, browser-core/MCP 25/25, server route group 92/92 and Python 13/13; app typecheck/build passed.
- The read-only exact-object Ninja dry-run `ninja -C out/Default_aster_x64 -n obj/chrome/browser/devtools/devtools/autofill_handler.o` hung for 30 seconds after entering the output directory and was interrupted (exit 130). No build or file writes occurred. Native compile/runtime verification remains open; the feature matrix remains **2/72 PASS (2.8%)**, with no completion claim.

### T30.1 heartbeat run-identity hardening — 2026-10-29

Scheduled-run claims now validate heartbeat conversation identity inside a SQLite `BEGIN IMMEDIATE` transaction before insertion. Same-run retries require matching job, start time and conversation; terminal updates cannot rewrite that identity and return an unchanged saved row on a matching retry. Deletion and retention preserve running claims, and a missing scheduled job fails closed as HTTP 409.

SQLite-backed route/store tests pass 26/26 (62 assertions), including active-run deletion/competing-start, missing-job rejection, heartbeat conversation matching, idempotent start/finish and immutable terminal state. Server typecheck, targeted Biome and scoped `git diff --check` pass; independent Luna review found no remaining issue in this slice.

This is integrity groundwork, not interrupted-run resumption. A completed heartbeat now starts a fresh turn in the same conversation with a bounded v1 checkpoint containing only validated run/job/conversation IDs, status and timestamps. It asks the model to inspect current state, avoid replaying completed side effects, and stop on uncertainty; the instruction is advisory. Result text, execution logs, tool inputs/outputs and approval state are omitted from the checkpoint. Focused app tests pass 6/6 (28 assertions), app typecheck passes, targeted Biome is clean after extracting the continuation lookup, and the full focused test/diff checks pass. No bounded running-stream/tool recovery, server-enforced no-replay, approval/lease restoration, headed restart or native Aster acceptance was added. R02 and T30.1 remain PARTIAL; the feature matrix remains **2/72 PASS (2.8%)**. The Aster feature branch had no incoming commits at `91f0e1865`; unrelated `origin/main` changes remain unmerged. Primary usage was 90% used (10% remaining), above the user's 5%-remaining checkpoint.

### A11 same-turn tool provenance follow-up — 2026-10-29

Successful citation URL matches in the research ledger now identify whether built-in `read` or `navigate` observed the URL in that research turn. The ledger still makes no claim that URL observation supports any factual statement. Focused research-request, ledger, and Browser MCP read tests pass 17/17 (38 assertions); app typecheck, targeted Biome, and `git diff --check` pass. Independent Luna medium review found no actionable issues. No live-provider or headed Aster check was performed; A11 remains PARTIAL pending claim-to-source evidence and live-provider verification. The matrix remains 2/72 PASS (2.8%).

### A11 bounded quote-presence check — 2026-10-29

The research contract now requests short verbatim quotes beside factual claims and citations. The ledger checks at most 12 quotes, each at most 240 characters, against bounded successful same-turn built-in `read` text for the exact cited URL. The UI reports exact string match found/not found and explicitly says that text presence does not establish claim support or truth. Research-request, source-ledger and Browser MCP read tests pass 21/21 (50 assertions); app typecheck, targeted Biome and `git diff --check` pass. Independent Luna review caught and corrected wording that overstated string matching as byte-for-byte. A11 remains PARTIAL pending semantic claim-to-source support and live-provider verification; no headed check was run. The matrix remains 2/72 PASS (2.8%).

### 5%-remaining commit checkpoint — 2026-10-29

The latest `git fetch aster --prune` found no incoming feature-branch commits; local `HEAD` and `aster/feat/aster-linux-ui` were both `91f0e1865`. At the user's 5%-remaining checkpoint, the accumulated dirty source, tests, evidence and plan updates were committed and pushed as `25722d89b`. The T31.1 CLI route tests passed 4/4 (18 assertions), targeted Biome and global diff check passed, and an independent Luna review found no actionable route/test issue. A11 tests passed 21/21 (50 assertions), app typecheck and targeted Biome passed. Matrix status remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED and 1 NOT_STARTED (72 total; 2.8% PASS); no source-only work was promoted to PASS.

Next continue the full 103-subtask plan: verify the T31.1 CLI and server together against a disposable packaged Aster runtime with a provisioned token; add semantic claim-to-source support to A11 and verify it with a live provider; then continue native build/link/runtime acceptance and the remaining feature, security, performance and release gates. Detailed sequence and limitations are in `NEXT_STEPS.md` and `CONTINUATION_HANDOFF.md`.

### T31.1 bearer-scheme parsing — 2026-10-29

The CLI route now accepts the HTTP authentication scheme case-insensitively while retaining exact token matching with a length check and `timingSafeEqual`. Focused route tests pass 5/5 (25 assertions), including lowercase/mixed-case schemes for status and stop plus rejection of Basic and incorrect bearer credentials. Targeted Biome and `git diff --check` pass; independent Luna review found no actionable issue. D01 remains PARTIAL pending the packaged CLI/server acceptance described above.

### A03 task-export credential-pattern follow-up — 2026-10-29

Task-history export screening rejects JWT-shaped values, Slack `xox*` and `xapp` token patterns, GitHub fine-grained PAT-shaped values (`github_pat_` plus at least 50 URL-safe body characters), and standard/encrypted PEM private-key headers across prompt, response, step, approval and artifact filename fields. Focused export tests pass 5/5 (14 assertions), including JWT response-preview, encrypted PEM step-error, Slack app-token, and GitHub fine-grained PAT sentinels. Targeted Biome and `git diff --check` pass. Independent Luna review caught the encrypted PKCS#8 false negative and the Slack `xapp-` gap; both are fixed. This remains heuristic filtering, not comprehensive secret detection, so A03 stays PARTIAL pending broader sentinels and selected-directory/native acceptance.
# 2026-10-29 — T31.1 local CLI route contract

Added focused source tests for the existing Aster task CLI server routes. The suite verifies that missing or incorrect bearer credentials cannot inspect or stop a run, the status response contains only the task identifiers/status/count fields, cancellation is reachable only through the explicit stop endpoint, and missing tasks/oversized IDs stay bounded. `bun test tests/api/routes/aster-cli.test.ts` passes 4/4 (18 assertions). This is route-level source evidence only: the CLI client and native Aster server have not been exercised together, and D01 remains PARTIAL pending a disposable packaged-runtime check with a provisioned token. No production route behavior was changed.


## GitHub source continuation: scheduled recovery and research attribution — 2026-10-29

Starting HEAD `9ee82a38f0410d2ca5cccbbf29fcf08b11890b4b` was confirmed current on `feat/aster-linux-ui`. A Git clone/ls-remote could not resolve `github.com` from this container, so source changes used SHA-checked authenticated GitHub writes. No host-local build tree, user worktree or native Aster package was inspected.

Implemented (1) an owner-aware stale scheduled-run predicate that does not fail a long task still running in the local worker, (2) a bounded local-server conversation liveness check that retains heartbeat claims when a sidecar turn is still running or its state is uncertain, and (3) research quote attribution that refuses to ascribe a quoted passage to the nearest of two distinct same-paragraph citation URLs and exposes an ambiguous-quote count.

**Verified focused source checks:**
- [40787505020](https://github.com/puneetdixit200/brower/actions/runs/40787505020): Aster app TypeScript, 19 scheduler tests, pinned Biome and whitespace pass.
- [40786688768](https://github.com/puneetdixit200/brower/actions/runs/40786688768): Aster app TypeScript, 22 research tests, pinned Biome and whitespace pass.
- Earlier 14-test [scheduler batch](https://github.com/puneetdixit200/brower/actions/runs/40786302159) also passed before the server-liveness follow-up.

**Unverified:** packaged Aster execution, service-worker restart while a live model/provider tool runs, server/tool liveness races, original source quote semantic support, native Wayland/Chromium UI and all release signing/update conditions. Aster remains **2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED** in the 72-feature acceptance matrix. No full-project completion claim. See [source/evidence report](evidence/aster-github-continuation-2026-10-29.md).
