# Aster continuation handoff and full implementation plan

Updated 2026-10-28. The full project remains incomplete. The previous goal was paused at the user-requested 5% allowance threshold. The user explicitly resumed it on 2026-10-28; the project remains incomplete. This file supplements, and does not reduce, the original master specification or the 95-subtask implementation plan.

## Mandatory implementation scope

The user explicitly requests **building all features**, including when the next agent cannot test every feature in its environment. Implement every requirement in `OMARCHY_ASIDE_INSPIRED_BROWSER_MASTER_BUILD_SPEC.md`, all 72 rows of `FEATURE_MATRIX.md`, and all 95 subtasks in `IMPLEMENTATION_PLAN.md`.

- Read the complete master specification and implementation plan, then work in dependency order with small owned batches.
- Build real end-to-end behavior: UI, browser/native bridge, backend/API, persistence, cancellation, permissions and error states where required. Mock-only screens, inert buttons, fixed sample data and written plans do not fulfill implementation requirements.
- If a browser API is missing, implement the required bridge/native support. True split view needs two actual browser contents, not a cosmetic layout. Durable task recovery needs the specified state/stream/tool behavior, not merely an interrupted badge.
- Runtime testing may be unavailable to a GitHub/cloud agent. Continue useful source implementation across the full feature set using the actual pinned APIs and repository architecture. Run available focused checks; do not spend the entire continuation only rerunning tests or writing plans.
- Record implemented behavior and unavailable verification separately. Source-implemented but untested features remain PARTIAL/NOT VERIFIED, with exact pending checks. Do not promote PASS, claim release readiness or mark the overall goal complete without the corresponding evidence.
- Keep real signing custody, updater/feed ownership and external credentials as explicit release gates. Do not fabricate keys, credentials, feeds, CRX files or test results.

## Verified progress accounting

Feature matrix snapshot: **72 total; 2 PASS (2.8%), 32 partial including one blocked, 38 NOT_STARTED** as of the remote implementation batch. Thirty-four features (47.2%) have implementation/evidence work recorded. This is status coverage; remaining effort is not uniform across features. No reliable weighted code/effort completion percentage has been measured.

PASS rows are U04 and U05. Native browser acceptance, package release, performance and broad security gates remain open.

## Repository and working policy

- Repository: `/home/puneet/Projects/aster-browser/upstream-browseros`.
- Branch: `feat/aster-linux-ui`.
- User remote `aster`: `https://github.com/puneetdixit200/brower.git`. Preserve `origin`, the BrowserOS upstream remote.
- First inspect status, branch, log and remote divergence. Preserve newer and uncommitted work. Fetch and fast-forward only when safe; never force-reset the user repository.
- Most recent functional feature commit before this documentation checkpoint: `bfb012e11` (current-window tab search/activation). Later documentation records the native product-object compile. Use actual HEAD/remote state for the final checkpoint identity.
- Use Luna medium for most implementation, focused checks and documentation. Use Terra medium for planning, judging, independent review and difficult integration. Use Sol only for exceptional unresolved cases after Terra cannot resolve them.
- Delegate narrow owned tasks. Avoid duplicate exploration, huge handoffs, parallel builds sharing one output directory and broad test repetition without a relevant change.
- User authorizes implementation, routine decisions, testing and reviewed milestone commits/pushes. Avoid unnecessary questions.
- At **5% remaining account allowance**, checkpoint all source and docs, record exact next TODO and live process state, stop owned tests/build processes and agents, push, pause the goal and stop until the user resumes. Never mark the entire project complete at a usage limit.

## Current native build: inspect before starting anything

Pinned Chromium checkout: `/home/puneet/Projects/aster-browser/chromium-aster-dev/src`, tag `155.0.8059.26`, HEAD `16c3e55476d3564bea713314b2fff638749ce3e6`. Dependencies and Linux sysroot are provisioned. Source/resources staged into this checkout come from Aster baseline `3fb17c5c6`; the newer tab-palette frontend has **not** been copied there.

- All 424 patches applied; full GN generation passed (35,759 targets / 5,077 files).
- Actual pinned compiler produced `browseros_product.o` and `browseros_product_state.o`, both exit 0. Along with the server config/manager objects, four translation units compile; this is not a linked browser.
- The full two-job graph (57,342 actions) and then a combined object preflight were intentionally interrupted to prioritize smaller checks. Completed outputs remain reusable.
- Server configuration and manager object preflight finished successfully: exit 0, all 2,556 scheduled actions completed, including both requested C++ objects. No task-owned Ninja build is expected to remain live at this checkpoint. **Check actual process state before starting one; never run concurrent Ninja processes against the same output directory.** A locator or lockfile alone is not proof of a live process.
- Host-local locator: `/home/puneet/Documents/Codex/2026-10-27/paste-this-into-the-new-codex/work/aster-native-build-state.json`. The last server session 73371 is terminal with exit 0; its log is `work/aster-native-server-objects.log` under that task directory. Another chat may not have access to the same tool-session handle; inspect the actual process and logfile in that case. A transient observation timeout is not proof that it stopped.
- Native checkout lock: `/home/puneet/Projects/aster-browser/chromium-aster-dev/.browseros-build-locks/src-0bf2808ad004.lock`.
- Earlier task-created source changes were archived at the task directory's `work/native-retry-backup/` before restoring pinned tracked files. No user project checkout was reset.
- A cloud/GitHub-only agent cannot inspect these host-local processes. Record that limit and continue source work in disjoint areas; do not assume the build passed, restart it remotely or overwrite the native baseline.

## Execution order and acceptance gates

### 1. Finish native bootstrap and actual browser integration

1. Verify the recorded successful product/config/manager object outputs and check there is no live build. Preserve completed outputs. Continue with the remaining changed translation units; fix concrete compiler/API failures against pinned Chromium.
2. Product-state compilation also passed. Compile the remaining exact loader and crash-reporter objects identified from generated Ninja rules:
   - `obj/chrome/browser/extensions/extensions/browseros_extension_loader.o`
   - `obj/chrome/browser/core/chrome_crash_reporter_client.o`
3. Resume the full `chrome chromedriver chrome_sandbox` build with **two total jobs**, then package the product. Do not run concurrent Ninja processes against the same output directory.
4. After the active baseline build is terminal, stage the latest reviewed source/resources through the normal pipeline. Keep source SHA, resource manifests and artifact provenance honest; do not silently label an older extension/native bundle as current HEAD.
5. Launch the actual Aster binary on a disposable profile with explicit `ASTER_DIR`. Verify baked product/profile paths, original Aster branding, extension ID `oifdmombnijnaiocijiacjhajbnpdlhb`, installed/READY state, new-tab UI and sandbox.
6. Verify complete Aster sidecar resources (including executable Bun and migrations), loopback listeners/authentication, health/CDP, tool-output paths, telemetry default OFF, restart persistence and clean shutdown. Do not substitute BrowserOS runtime evidence for native Aster evidence.
7. Test B01–B10 in that binary: secure navigation/search/back/reload, tabs and recovery, downloads/files, history/bookmarks, incognito, supported extensions/password managers, media/WebRTC/permissions/devtools and session restore.

### 2. Build the complete original browser/UI experience

Implement remaining U01–U18 and the corresponding T11–T16 tasks: original collapsible/resizable sidebar; real bookmark/chat/tab groups and task cards; context selection; provider/model/reasoning controls; truthful local/cloud processing labels; themes/scaling/low-power behavior; complete command center and shortcuts; actual split browser panes; selection tools; screenshot/lasso context; per-page side panel and durable drafts; task timelines/artifacts; clear approvals; onboarding/import/privacy explanation. Existing partial behaviors should be extended, not replaced with placeholders.

The tab palette now queries current-window tabs, filters title/URL, rechecks membership before actual activation and handles errors/cancellation. Five helper tests, typecheck/Biome/WXT build, Terra review and headed BrowserOS-fixture activation/repeat-key checks pass. U10 remains PARTIAL for native/OS acceptance and broader command-center parity. Query and update are separate APIs, so atomic window confinement is not guaranteed.

### 3. Complete agent execution and recovery

Implement A01–A13 with real provider/tool dispatch and policy boundaries: page comprehension; multi-page browsing; sandbox file export/download/copy; cancellation; durable transcript/stream/tool state and recovery; approvals for consequential actions; queue versus steer; isolated parallel tasks/tabs; read-only/Guard/Full semantics; incognito non-persistence; research citations; human handoff; offline/missing-model recovery.

A05 currently restores interrupted visibility only. It does not replay transcripts/tools or resume execution. Preserve per-record recovery markers, terminal/deleted precedence and 404-only interruption classification. Do not automatically replay side effects without the required policy/user approval.

### 4. Finish memory and routines

Complete M01–M06: history retrieval, episodic task notes, editable Markdown/provenance, retention/opt-out, incognito exclusions and validated stale recipes. Complete R01–R04: cron tasks, heartbeat continuation, non-overlap/missed-run policy, pause/resume/edit/delete/run-now. Test actual persistence and restart behavior where available; document the remaining runtime checks otherwise.

### 5. Complete credentials, security and developer surfaces

Implement P01–P04: never expose saved passwords to models, user-mediated login/autofill, origin-safe blind autofill where supported, and user-controlled MFA/passkeys. Complete S01–S05 across actual tools and native paths: prompt-injection/authorization boundaries, filesystem/symlink containment, authenticated loopback MCP/CDP, redaction and opt-in data disclosure, owned extension/update identity. Complete D01–D03: documented local CLI task control, restricted MCP tools and development-profile automation REPL.

The development identity/public key is not signing custody. Signed release still requires real private-key ownership and provisioned update infrastructure. Keep release paths fail-closed.

### 6. OS, packaging, lifecycle and performance

Implement and verify O01–O04 and F01–F05: AppImage/menu/install/uninstall, Wayland/Ozone with supported fallback, suspend/resume/notifications/XDG paths, preservation of Omarchy configuration, startup/tab-switch/input/idle/browsing budgets, backpressure and stress. Install an opt-in launcher only after verifying its actual binary. Compare Aster and upstream on the same host/workload. Route splitting and a sampler are source changes, not measured performance wins.

### 7. Final acceptance

Audit every master-spec requirement, all 72 feature rows and all 95 subtasks against authoritative code/build/runtime evidence. Complete untested and blocked gates before release. Only the complete audited product can close the overall goal.

## Local tool commands and constraints

Private frozen Python environment on this host:
`/home/puneet/Documents/Codex/2026-10-27/paste-this-into-the-new-codex/work/aster-native-venv/bin/python`

Python discovery (cwd `packages/browseros`):
```sh
<python-above> -m unittest discover -s bos_build -t . -p '*_test.py'
```
Most recent broad Python run was 1,345 tests, three skipped; later fixes have focused suites recorded in PROGRESS/evidence. Do not describe the older broad run as covering every later edit.

Bun: `/home/puneet/.local/bin/bun`. Go: `/home/puneet/.local/opt/go/bin/go`. Private uv: task directory `work/native-build-tools/bin/uv`. Native configure/compile now use adjacent depot_tools with self-update disabled.

After verifying there is no live build and the repository is clean, the native driver is:
```sh
python packages/browseros/scripts/aster_native_debug_build.py   --chromium-src /home/puneet/Projects/aster-browser/chromium-aster-dev/src   --jobs 2
```
Ensure uv/Bun/Go are on PATH; use the existing private Python environment via `UV_PROJECT_ENVIRONMENT` if needed. Set `NODE_OPTIONS=--max-old-space-size=4096` for the WXT build. The driver uses the explicitly gated Linux debug/source/unpacked mode, with signing/upload disabled. Never use `--no-sandbox`.

Run app/onboarding builds sequentially because branding modes share output directories. Existing headed BrowserOS fixtures need a fresh profile, explicit disposable `BROWSEROS_DIR`/`BROWSEROS_USER_DATA_DIR`, and supported AppImage extract-and-run mode when FUSE is unavailable. Prefer a verified loopback-only network namespace. The latest tab-palette smoke used local fixtures and a disposable profile but did not verify network namespace isolation; preserve that limitation. A backgrounded Radix dialog can remain in the DOM with `data-state=closed`; do not mistake presence for an open palette.

## Full feature checklist snapshot

The canonical descriptions, dependencies and evidence remain in FEATURE_MATRIX.md. The canonical detailed 95-task breakdown remains in IMPLEMENTATION_PLAN.md; complete every item, including those not yet executable in the next agent's environment.

| ID | Feature | Status at handoff |
|---|---|---|
| B01 | Start browser, render HTTPS pages securely | NOT_STARTED |
| B02 | Navigate/search from address bar | NOT_STARTED |
| B03 | Forward/back/reload/stop navigation | NOT_STARTED |
| B04 | Tab create/select/close/reopen/pin/drag | NOT_STARTED |
| B05 | Downloads, progress, files on disk | NOT_STARTED |
| B06 | History, bookmarks, search/import/export where supported | NOT_STARTED |
| B07 | Incognito separated from normal history/tasks | NOT_STARTED |
| B08 | Extensions and normal password-manager support | NOT_STARTED |
| B09 | Media, WebRTC, permissions, devtools | NOT_STARTED |
| B10 | Session restore without profile corruption | NOT_STARTED |
| U01 | Collapsible/resizable original sidebar | PARTIAL (source-only) |
| U02 | Sidebar groups: bookmarks/chats/tabs | PARTIAL (source-only) |
| U03 | Recent task cards, real statuses | PARTIAL (source-only) |
| U04 | Search/Ask input modes | PASS |
| U05 | URL detection and search provider | PASS |
| U06 | `@` tab/history/file/memory context selector | PARTIAL |
| U07 | Provider/model/reasoning controls | NOT_STARTED |
| U08 | Local/cloud mode clearly describes actual processing | NOT_STARTED |
| U09 | Light/dark/system, scaling and low-power mode | PARTIAL |
| U10 | Keyboard shortcuts and command palette | PARTIAL |
| U11 | True split tab browser contents | PARTIAL |
| U12 | Text selection summarize/translate | PARTIAL |
| U13 | Lasso/screenshot contextual tools | NOT_STARTED |
| U14 | Side panel attached to current page | PARTIAL |
| U15 | Per-tab side-panel draft persistence | PARTIAL |
| U16 | Task detail timeline and artifacts | PARTIAL |
| U17 | User-friendly permissions dialog | PARTIAL (source + focused CI) |
| U18 | Onboarding/import and privacy explanation | NOT_STARTED |
| A01 | Ask basic page question | PARTIAL |
| A02 | Multi-page browse/click/type/navigation | PARTIAL |
| A03 | Download/copy/export files into sandbox | NOT_STARTED |
| A04 | Stop/cancel ongoing tool run | PARTIAL |
| A05 | Durable task state + crash recovery | PARTIAL |
| A06 | Approval before sends/posts/payments | PARTIAL |
| A07 | Queue vs steer mid-run | NOT_STARTED |
| A08 | Parallel isolated agent tabs/tasks | NOT_STARTED |
| A09 | Read-only/Guard/Full access semantics | PARTIAL |
| A10 | Incognito tools enforce no persistence | NOT_STARTED |
| A11 | Research/deep mode with sources | NOT_STARTED |
| A12 | Human handoff for MFA/CAPTCHA | NOT_STARTED |
| A13 | Model missing/offline error handling | PARTIAL |
| M01 | History-based retrieval | PARTIAL |
| M02 | Task-derived episodic notes | PARTIAL |
| M03 | Editable Markdown + provenance | PARTIAL |
| M04 | Retention 30/90/forever and opt-out | PARTIAL |
| M05 | Incognito never remembered | PARTIAL |
| M06 | Site recipes, staleness and validation | NOT_STARTED |
| R01 | Cron schedule creates new task | PARTIAL |
| R02 | Heartbeat continues existing task | NOT_STARTED |
| R03 | No overlap/missed-run policy | PARTIAL |
| R04 | Pause/resume/edit/delete/run now | PARTIAL |
| P01 | Never expose saved password to LLM | NOT_STARTED |
| P02 | User-mediated normal login/autofill | NOT_STARTED |
| P03 | Automated origin-safe blind autofill if possible | NOT_STARTED |
| P04 | MFA/passkey handled by user | NOT_STARTED |
| S01 | Prompt injection blocked at tools/authorization | PARTIAL |
| S02 | Path traversal/symlink containment | PARTIAL |
| S03 | MCP/CDP bound to loopback and authenticated | PARTIAL |
| S05 | Aster owns its extension identity and update channel | PARTIAL / BLOCKED |
| S04 | Redacted secrets and opt-in model data disclosure | PARTIAL |
| D01 | Documented local CLI task control | NOT_STARTED |
| D02 | MCP browser tool server, restricted scopes | NOT_STARTED |
| D03 | Browser automation REPL restricted to dev profile | NOT_STARTED |
| O01 | Omarchy AppImage launch and menu integration | NOT_STARTED |
| O02 | Wayland/Ozone, XWayland fallback | NOT_STARTED |
| O03 | Suspend/resume, notifications, XDG dirs | NOT_STARTED |
| O04 | No accidental modification of Omarchy configs | NOT_STARTED |
| F01 | Warm startup baseline budget | NOT_STARTED |
| F02 | Fast tab toggle and no input jank | NOT_STARTED |
| F03 | Efficient idle CPU and RSS overhead | NOT_STARTED |
| F04 | No slower typical browsing than upstream beyond budget | NOT_STARTED |
| F05 | Backpressure under many tabs/tasks | NOT_STARTED |


## Subsequent remote implementation checkpoint — 2026-10-28

User resumed the project. The cloud session could not clone through container Git because GitHub DNS resolution failed, but the authenticated GitHub connector committed a substantial, source-only batch: real resizable Aster UI sidebar (U01), current-window tab/HTTP(S)-bookmark/conversation sidebar (U02), real credential-filtered local task cards (U03), safer one-time private tab/prompt handoff (U06/S01), and persisted extension-only scaling, theme and reduced motion (additional U09 work). An isolated TypeScript helper strict check plus 3 Node assertions pass; no full WXT/native build ran remotely. See [remote batch evidence](evidence/aster-remote-implementation-2026-10-28.md). The feature matrix, progress and next steps are canonical; release signing, native binary and remaining subtasks are still open.


## Focused browser and approval feature batch — 2026-10-28

After the prior remote checkpoint, commits on `feat/aster-linux-ui` added bounded Chromium bookmark tree paths, current-window tab pin/unpin/close actions, stricter server approval for mutating tabs/history, credential-redacted human tool-review previews, and explicit local Markdown export of real task summaries without raw tool input/output. The [focused Linux GitHub Actions run](https://github.com/puneetdixit200/brower/actions/runs/40682050699) passed extension TypeScript, server TypeScript, 12 focused Bun tests, and pinned Biome. No native binary, Omarchy GUI session, full workspace suite or release verification was executed. The canonical feature accounting is **2 PASS / 32 PARTIAL / 38 NOT_STARTED**. U17 is PARTIAL, not PASS. See [batch evidence](evidence/aster-feature-batch2-2026-10-28.md).


## Most recent source-only checkpoint — 2026-10-28

User asked to partially implement all 38 untouched feature rows and defer testing. The authenticated GitHub continuation added source-level foundations for 36 of those 38, with two remaining NOT_STARTED because an honest safe implementation is not available yet: R02 durable heartbeat continuation and P03 native origin-bound blind autofill. **Matrix is now 2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED, 2 NOT_STARTED.** No tests, native builds, or GUI acceptance were run on the new source. See [foundation batch evidence](evidence/aster-source-foundations-38-2026-10-28.md). Earlier feature-table snapshots in this document are historical; use `FEATURE_MATRIX.md` for current values. Do not equate source partials with passing tests or full Aside parity.

## Superseding model policy and latest stop — 2026-10-28

Main model: Terra. Use at most five Luna medium subagents, and use Luna only for implementation and independent review; do not use Sol or Terra as subagents. Save tokens. The continuation fetched 125 commits through `8454a673d`; current HEAD includes this checkpoint. Account allowance was 3%, below the user's 5% stop threshold. Resume only when requested and allowance permits.

The previous 72-row status snapshot in this document is historical. See the superseding local source checkpoint below and the current matrix; continue the full master specification, not only newly changed rows.


## Current local R02/P03 source checkpoint — 2026-10-28

This section supersedes the preceding R02/P03 counts and snapshot; other table entries remain historical until their evidence is updated. The current uncommitted source adds a task/heartbeat mode, per-job conversation identity and heartbeat persistence. Continuation is permitted only for the first heartbeat or after a completed run; failed/interrupted/unknown/unavailable history fails closed. App/server typechecks and 52 focused tests passed. Disposable SQLite creation and the actual v18-to-0019 upgrade passed, preserving existing rows/defaults, and a `DbConversationStore` transcript survived close/reopen. The migration rewind fixture was fixed; the expanded server suite passes 61/61 and typecheck passed on rerun after an intermittent TS2589. R02 is PARTIAL because in-flight replay, leases, approval recovery, and restart acceptance are absent or unverified.

A separate U02 sidebar slice adds nested bookmark-folder drill-down/back with global search, HTTP(S)-only opening and the private-window guard. Following an independent-review fix, its focused tests pass (6/6), as do Biome and app typecheck. Native integration and headed browser verification remain pending; U02 remains PARTIAL.

An Aster-only native Autofill guard denies direct `list`, `add`, and `fill` with `approval_unavailable`. That guard is not a browser-owned consent or autofill feature, so P03 remains NOT_STARTED. At this historical checkpoint the native checkout had not yet received the changes; the later staging update at the end of this handoff records their application and GN regeneration. Native compile and browser testing remain pending. See [R02/P03 checkpoint evidence](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md).

Current feature accounting: **72 total; 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED**. The overall project remains incomplete. The reviewed guard/test hunks are staged in the native checkout and Aster Debug GN regeneration succeeded. Compile the Autofill object and focused DevTools browser-test target, run the focused native test, then proceed with the ongoing browser build and disposable-profile Aster runtime. Test task/heartbeat selection, per-task separation, same-conversation continuation after completion, fail-closed failed/interrupted runs, persistence/restart, nested bookmark drill-down/back/search/private-window behavior, Aster direct Autofill denials, and unchanged BrowserOS behavior. Continue all 95 subtasks and remaining live feature tests.

Use Luna medium for implementation, focused validation, and documentation, including independent review as requested. At 5% remaining allowance, checkpoint source/docs, exact TODO and live process state, stop owned tests/builds/agents, push if the active instruction requires it, and pause. Never mark the complete project done at the threshold.

## Current continuation update — 2026-10-28

The user's latest model instruction supersedes prior model-policy text: use Luna
medium for all project work, including planning and independent review; do not
use Sol or Terra, and keep Luna subagents at five or fewer. Latest matrix count
remains **2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED**. R03 and U07
have new focused evidence in `PROGRESS.md`; each remains PARTIAL pending actual
headed/native checks. A05's lifecycle metadata and interrupted transcript
visibility are committed, but A05 remains PARTIAL because execution resumption,
stream/tool recovery, approval recovery and packaged restart acceptance remain
open.

The pinned checkout's loader, crash reporter, Autofill handler, and focused
DevTools test object compile. The linked `browser_tests` target expanded to
52,858 actions; its one-job build stopped cleanly at 621 actions due to slow
progress. No linked binary or test run exists. The final snapshot was 4.8 GiB
available RAM, 9.1 GiB swap used, and 267 GiB disk free. Preserve the dirty
Chromium checkout and generated outputs; choose a narrower/reusable build plan
before another attempt. Do not count object compilation as runtime or
browser-test acceptance. At 5% remaining allowance, checkpoint and stop as the
user instructed; keep the full Aster goal active/incomplete otherwise.

### Heartbeat missing-run-history follow-up — 2026-10-28

Current source tightens the first-run exception: continuation is allowed with no previous run only when the job has no saved conversation ID. A saved conversation with missing run history now fails closed. The four heartbeat helper tests pass (4/4); the focused `ChatService` suite passes (18/18), including a synthetic-model SQLite close/reopen integration that verifies transcript continuation and that ordinary scheduled tasks stay out of chat history. Independent review passed. The pinned Chromium staging check applied only exact committed guard/test hunks to two already-dirty files, and reconstructed expected patched files byte-match. Aster Debug GN regeneration succeeded. The single-object Ninja target was unknown and no archive/browser-test binary was available, so no compile or browser test ran; no broad build was started. Native compile/browser acceptance remains pending. Interrupted-execution replay remains unimplemented, as do lease/ownership and approval recovery, so R02 remains PARTIAL. See [R02/P03 evidence](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md).

## Latest U16 transcript and P03 Actor Login checkpoint — 2026-10-28

U16's task detail now includes the saved prompt, ordered safe step summaries and saved final response where available. The Markdown report injection issue is fixed; focused tests pass 10/10 and the app typecheck passes. No headed UI run followed the change. U16 remains PARTIAL pending headed UI, persistence and artifact/download verification.

P03 remains NOT_STARTED. The native checkout contains the exact Aster Autofill guard/test hunks and Aster Debug GN regeneration succeeded. Native compile and browser tests remain pending; native build work is ongoing and this handoff records no completion count. Continue from the live build state, then compile the Autofill and focused DevTools test targets and verify Aster denials plus unchanged BrowserOS behavior.

The reviewed Actor Login API cannot supply Aster's consent boundary by calling credential retrieval from DevTools. Implement a browser-owned broker that binds the live `WebContents`, `Profile`, primary main-frame token and committed origin; keeps credential results in native memory; presents a browser-owned credential chooser requiring a fresh user gesture; revalidates target/document/origin before fill; cancels on navigation, detach, timeout or mismatch; and returns only coarse status. Do not expose credential metadata or inherit persistent Actor Login grants. See [P03 API review](evidence/aster-p03-actor-login-api-review-2026-10-28.md). Overall matrix: 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED; the project remains incomplete.

### A05 persisted lifecycle follow-up — 2026-10-28

Current uncommitted source adds migration `0020_add_conversation_run_state.sql` for conversation/run IDs, lifecycle status and timestamps. Startup changes stale `running` rows to `interrupted`; the app then fetches and preserves the saved transcript without opening a replacement stream. Deleting a conversation removes both its lifecycle row and conversation data. Focused checks pass: 63 server tests, 5 app client tests, app/server typechecks and targeted Biome. This is metadata plus transcript display only: no saved stream/tool state, tool replay, execution continuation, lease/ownership recovery or approval recovery. No new headed or packaged-native crash/restart acceptance was performed. A05 remains PARTIAL, and the changes are uncommitted pending parent review. See [A05 evidence](evidence/aster-a05-lifecycle-2026-10-28.md).

Next for A05 after review: verify app/server behavior over an actual server process restart, transcript rendering without a new stream, delete cleanup, and terminal/deleted precedence. Confirm no tool replay occurs. Continue full execution recovery and native/runtime acceptance as separate open requirements; do not mark A05 complete from lifecycle metadata or focused tests alone.
