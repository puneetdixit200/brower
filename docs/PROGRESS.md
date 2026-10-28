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
- The current task record schema has no downloadable artifact descriptors, so the detail page reports an empty artifacts state; full transcripts and artifact rendering are not implemented. Timeline helper tests pass (4/4), app typecheck and targeted Biome pass. Headed BrowserOS v0.51.0 smoke in the network-isolated disposable profile verified task selection, exact task ID, ordered step preview, hidden credential-shaped fixture, and empty-artifacts state. U16 remains PARTIAL.

### A05 follow-up — interrupted task visibility recovery (partial)

- Task History checks each distinct conversation with a locally stored `running` task against `/chat/:conversationId/state`. It creates idempotent task-scoped recovery markers only after HTTP 404; HTTP 200, server errors, and network failures create no marker. The UI overlays `interrupted` only while the matching stored task still exists and remains `running`, so terminal records and deletions take precedence. Markers use separate extension storage keys; recovery never rewrites the task-history object. No schema migration or transcript copy was added.
- Focused recovery tests pass (13/13 app; 23/23 server auth/chat route), app/server typechecks and targeted Biome pass. The headed disposable-profile recovery smoke and a true BrowserOS plus Bun sidecar SIGKILL/restart smoke both pass. The server's originless state-read exception is limited to headerless localhost extension GETs for `/chat/:id/state`; other chat routes continue to require trusted extension origin. This recovers task status visibility only: active streams, partial transcripts, and tool side effects are not resumed, and server run state remains in memory.

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
