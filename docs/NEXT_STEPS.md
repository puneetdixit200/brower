# Aster next steps

Checkpoint: 2026-10-29, branch `feat/aster-linux-ui`. This repository contains the full current source and implementation plan, not a finished browser release. The user explicitly authorized resuming on 2026-10-28. The goal remains incomplete; the prior pause is retained as a historical checkpoint.

## Complete build scope and handoff

**Build every feature**, even when the next agent cannot runtime-test them all. Continue real source implementation with available focused checks, record unavailable verification explicitly, and do not claim PASS from source alone. The full prioritized handoff, native build state, tool commands and 72-feature checklist are in [CONTINUATION_HANDOFF.md](CONTINUATION_HANDOFF.md); the canonical detailed 103-subtask breakdown remains in IMPLEMENTATION_PLAN.md.

## Next execution order

1. Finish the prepared extension-resource staging, native pin-gate and incremental staging checks. Both onboarding branding modes pass emitted title/favicon checks; the development extension build now passes with `NODE_OPTIONS=--max-old-space-size=3072` (24.1 MB output). Signed release validation remains separate.
2. Preserve `../chromium-aster-dev/src`: it has the pinned Chromium 155.0.8059.26 and Aster patch set, but no linked `chrome` or `browser_tests` binary. Existing focused native objects are present. `.ninja_log` is absent, the in-tree Ninja is 1.12.1 and the depot_tools wrapper cannot start; first determine whether a bounded in-tree Ninja invocation can reuse objects before any native build. Do not regenerate GN or start the broad graph yet.
3. Continue all remaining source work in the 103-subtask plan. T19.4 now persists schema-created lifecycle events from `ConversationRuns`, revalidates conversation/run-scoped events on recovered snapshots, normalizes orphaned `running` status to `interrupted`, and transactionally/idempotently persists one interruption event. Both the per-run and global retention caps apply during normal appends and recovery. Snapshots expose `tracePersistenceDegraded` when trace storage fails without changing task execution. Latest root-verified checks: server 78/78 across seven suites, app 81/81, browser-core/MCP 25/25, server route group 92/92, Python 13/13; app typecheck/build (24.1 MB), server typecheck/direct tsc, Biome and diff-check pass. Independent Luna review found no remaining T19.4 issue. The remaining T19.4 gates are actual process-restart, live-provider, native and packaged-runtime acceptance; then continue the remaining UI, agent and browser tasks.
   T31.1 now has focused route tests for bearer denial, case-insensitive Bearer scheme parsing, status-field minimization, explicit cancellation, missing tasks and oversized IDs (5/5); keep D01 PARTIAL until the CLI and server are exercised together against a disposable Aster package with a provisioned token.
4. With a runnable binary, verify extension READY/new tab, sandbox, isolated profile/state, sidecar launch/authentication, privacy/restart and tool output; then test the command palette, lazy routes and remaining headed/native acceptance.
5. Complete package/install/uninstall, release signing/update ownership, security, matched performance and lifecycle gates. Promote features to PASS only with matching Aster runtime evidence.

## Cost-conscious execution

- Use Luna medium for all implementation, focused tests, planning, judging and independent review. Do not use Sol or Terra for project work.
- Deploy no more than five Luna medium subagents at once; keep assignments narrow and file ownership separate.
- Keep handoffs narrow, reserve file ownership, avoid duplicate investigations and repeat broad checks only after a relevant change or failure.

## Current evidence and limits

- S05 development extension identity, origin/reporter boundaries and headed recovery regression have evidence in `evidence/aster-identity-2026-10-28.json`; release provisioning remains blocked.
- Native Python suite: 1,330 tests run, three skipped. Native patch doctor: 422 patches across 38 features. The actual extracted product assertion was checked with all eight Boolean combinations. Aster Debug GN regeneration and several native translation units have been verified; no linked Chromium browser/test binary or runnable native Aster package/runtime has been verified.
- T04 source implements default-off private consent, content-free error envelopes, fixed server counters, revoked queue/lease denial, app native-metric suppression, and visible settings. Latest normal headed consent/cross-tab/reload checks pass in isolated state. Advanced error/restart verification also passes in explicit disposable state. A portable harness is available under `packages/browseros-agent/scripts/dev/aster_privacy_smoke.py`; the packaged native gate remains open.

See `FEATURE_MATRIX.md` for all 72 features and `IMPLEMENTATION_PLAN.md` for 103 subtasks.

## Prior continuation checkpoint — 2026-10-29

The current local source batch strengthens P01 screenshot/AX and connector-output redaction, T03.1 source control-plane inventory, T03.2 shutdown caller checks, T06.2 FIFO handling, T28.3 site-recipe record validation, A05 recovery identity, T14.2/U08 provider-processing disclosure, U18's first-run privacy walkthrough, and T31.3's dev-REPL command/profile boundary tests. `git fetch --all --prune` found no new commit on the Aster feature branch: local `HEAD` and `aster/feat/aster-linux-ui` are both `91f0e1865`. It advanced upstream `origin/main` from `02291b424` to `0f7ead670`; these upstream changes remain unmerged. Preserve the existing dirty working tree. The feature matrix remains 2/72 PASS (2.8%). Focused Klavis service tests pass 11/11, including complete cookie-header, serialized JSON secret-field, PEM private-key, and Basic/Digest/Bearer authorization redaction; the dev-REPL suite passes 8/8; the filesystem suite passes 177/177 (386 assertions), including FIFO nonblocking coverage; site-recipe tests pass 4/4 (85 assertions); shutdown/index route tests pass 25/25 (127 assertions); focused U08/U18 tests pass 13/13 (56 assertions); app/server typechecks, targeted Biome and diff checks pass. The development extension build passes with unresolved-font, Rollup annotation, and large-chunk warnings after new-tab disclosure plumbing. Earlier focused app recovery/run-ID tests passed 22/22; server chat/run/CORS tests 57/57; recent-task/login/shortcut tests 17/17; artifact route tests 12/12; credential/MCP catalog tests 8/8; Rust `browseros-decide` view tests 52/52, core screenshot tests 5/5 and MCP capture tests 3/3. The `test:lib` group has two PostHog failures in group-run context; its focused file passes 4/4. The POSIX device-node race is still open. These are source/fixture results, not a native Aster or real-pixel acceptance run.

1. Build and inspect the Aster native development binary to prove the descriptor-selected legacy TypeScript `aster_server` resources are staged and launched; then verify effective sockets and Authorization forwarding against the T03.1 inventory. The source audit and process-selection trace have independent Luna review. Keep S03 PARTIAL until packaged listener/auth verification.
2. Continue P01 by validating the best-effort Klavis/Strata output sanitizer against real connector/provider responses, then audit the remaining credential handoff paths. The sanitizer masks common labelled secrets and omits uninspectable images but cannot prove arbitrary unlabelled values are safe. The Aster TypeScript agent and standalone MCP catalogs filter raw `run`/`evaluate`; the Rust MCP crate is shared with other products and has no trusted Aster identity, so do not add a global Rust tool restriction without a product-boundary decision. Keep metadata filtering documented as defense-in-depth. P01 remains PARTIAL pending native Autofill, provider and rendered-browser screenshot acceptance.
3. Continue U15 by implementing an opaque persistent tab GUID in native tab extra data and a narrowly scoped extension API; migrate legacy numeric records only when their same-session live tab is known. Test duplicate URLs, stale/closed attachments, OTR denial, migration and restart, then run `aster_sidepanel_draft_restart_smoke.py` on a linked Aster build. Preserve the dirty adjacent Chromium checkout and its build outputs.
4. Verify T18.1/U18 in a disposable headed Aster profile when a runnable binary exists: confirm the optional user-triggered handoff opens Chromium's `chrome://settings/importData`, Chromium owns the import choice, and the extension cannot change the profile location owned by native setup. Then test fresh-profile completion and restart without reading an existing profile. Also verify U03 Recent Tasks, R02/R03 alarms/restart/overlap/no-replay, and U17 keyboard/screen-reader and denial-timeout behavior.
5. Run extension and prepared-resource/GN staging validation from `ASTER_NATIVE_DEVELOPMENT_PLAN.md`. Preserve the native checkout; `.ninja_log` was absent after a Ninja-version mismatch, so locate a compatible Ninja and recover/locate the log before any build, log rewrite or GN regeneration. Then build/link a pinned native Aster browser with bounded jobs and verify extension READY, sandbox, profile/state isolation, sidecar auth, privacy and Autofill behavior.
6. Continue the remaining 103 subtasks and MUST rows, then run matched performance/security/release gates. Signing and update ownership remain unprovisioned.

At the latest usage check, primary allowance was 62% used and weekly allowance 39% used (38% and 61% remain), above the user's 5%-remaining commit-and-stop threshold. Refresh usage at batch boundaries.

## Latest resumed checkpoint — 2026-10-29

`git fetch --all --prune` found no new commit on `aster/feat/aster-linux-ui` (`91f0e1865`). `origin/main` advanced from `0f7ead670` to `7a032719e`; it remains unmerged because the Aster branch is pinned to a separate base and the worktree is broadly dirty. P01 now redacts suffixed secret keys, including repeated value/data/text suffixes, while preserving count fields; no real connector-provider response has been tested. This checkpoint's T19.4 status is superseded by the newer integration note below: `ConversationRuns` now persists schema-created events and revalidates scoped stored events in recovered snapshots; process-restart, live-provider, native and packaged-runtime acceptance remain open. The feature matrix remains 2/72 PASS (2.8%).

Focused checks in this resume: 49 recovery/task-history/recent-task tests; 12 provider-disclosure/onboarding tests; 2 task-artifact download tests; 7 site-recipe/artifact tests; 11 Klavis tests; 8 dev-REPL tests; and 41 T19.4 task-contract/run/chat tests. App and server typechecks plus targeted Biome passed. The development extension build passed with a 3 GB Node heap and produced 24.1 MB; the default 2 GB heap first aborted with OOM, and the successful build still reports unresolved-font, Rollup annotation and large-chunk warnings.

The read-only native audit found no linked `chrome`/`browser_tests` binary and no `.ninja_log`; the existing Chromium checkout has 319 dirty paths, in-tree Ninja 1.12.1, 5.8 GiB available RAM and 14 GiB swap in use. Preserve it; first establish whether a bounded in-tree Ninja command can reuse objects before attempting a native build. Matrix statuses remain unchanged. Latest account usage: 62% primary and 39% weekly used (38% and 61% remain), above the user's commit/push/stop threshold of 5% remaining.

## Requested stop condition

When account usage falls to 5% remaining, commit and push all current work, refresh this next-steps list, stop test processes and agents, and pause the goal until the user requests a resume.

## Latest server milestone

The local-only Linux x64 server archive includes verified Bun 1.4.2 and migration resources. Independent startup returned health OK with CDP connected, telemetry off and isolated Aster state. Python discovery ran 1,333 tests with three skipped; focused builder, state and filesystem checks and workspace typechecking pass. Native Aster browser and packaged MCP output verification remain open.

The task-report exporter screens GitHub fine-grained PATs (`github_pat_` plus at least 50 URL-safe body characters) alongside JWT-shaped values, Slack xapp tokens, standard/encrypted PEM private keys, and existing credential patterns. The focused report suite passes 5/5 (14 assertions), including raw-tool-data omission and Markdown-fence handling. This is heuristic source coverage only: A03 remains PARTIAL pending broader sentinel coverage and selected-directory/native acceptance, and the matrix remains 2/72 PASS.

## User-requested stop checkpoint — 2026-10-28

Commit and push all current source and Markdown now, then stop. Resume only on user request. The new onboarding producer is a development checkpoint; native Aster compilation and launch remain unverified. Next: finish onboarding integration checks, implement the gated unpacked extension development path in `ASTER_NATIVE_DEVELOPMENT_PLAN.md`, then attempt a low-concurrency pinned native build and repeat runtime/privacy checks. Use Luna medium for implementation and Terra for planning/review; reserve Sol for exceptional unresolved cases.


## GitHub-only resume — 2026-10-28

The latest source commits address the Aster onboarding Vite favicon ordering, add brand-specific output validation, defer a prepared-resource import to avoid premature pipeline registration, and add a **read-only** gated unpacked development extension validator plus focused tests. See [the resume checkpoint](evidence/aster-github-resume-2026-10-28.md). These changes were committed to `aster/feat/aster-linux-ui` remotely; this session did **not** run the builds/tests, inspect the user's local working tree, or build native Chromium.

**Immediate next step:** run both onboarding modes and focused Python tests on the user's Omarchy checkout; fix regressions before wiring the unpacked validator through prepared-resource staging, GN flags, and native extension loading. Keep signed-CRX release checks intact. Then attempt the monitored jobs=2 native build and runtime checks. The user-requested earlier pause above is historical, not the current instruction.


## Source-only unpacked debug integration — 2026-10-28

The GitHub branch now contains a gated `--aster-unpacked-dev` source/build-planner path, resource ZIP verification/staging, a GN staging action, an Aster-only asynchronous unpacked loader branch, and product-owned server/icon rules. See [evidence checkpoint](evidence/aster-unpacked-integration-source-only-2026-10-28.md). **These changes have not been compiled, tested or run on Omarchy.** Preserve all previous feature statuses. Run the focused integration and build commands in the checkpoint once local Chromium is accessible, fix actual failures, then continue the 103 implementation subtasks. Release keys/update-service ownership, full browser UI parity, native packaged checks, performance and security gates remain open.


## Next checkpoint — source implementation and UX (2026-10-28)

The [master build specification](OMARCHY_ASIDE_INSPIRED_BROWSER_MASTER_BUILD_SPEC.md) now lives in this repository. The latest source-only work adds a dedicated WXT debug build, GN metadata staging, a guarded native build driver, an opt-in Omarchy launcher, an Aster route command palette, and CPU/RSS sampling. See [checkpoint evidence](evidence/aster-source-development-2026-10-28.md). No native binary or runtime parity is verified.

**Next critical blocker:** on the actual Omarchy host, reconcile local working-tree changes without force-resetting. Run the prepared-resource builds, apply native patch mapping, generate GN against the pinned Chromium checkout, and compile with jobs=2; fix any compile/API or packaging errors. Only then can the command palette, extension READY, split view, sandbox/state, sidecar, privacy and performance be validated in an actual Aster binary. Finish remaining UI/agent/security tasks in `IMPLEMENTATION_PLAN.md`. Keep all signing/update resources unclaimed until provisioned.


**Performance next action:** compile the route-split extension and compare initial JS transfer/parse against its pre-splitting revision, then use `aster_perf_sample.py` with matching idle workloads. Confirm that lazy settings routes open normally and chat-session context is not lost. No performance result has been measured so far.

## Local verification resumed — 2026-10-28

Fetched 66 remote commits and fast-forwarded cleanly from `fd3e59910` to `179ef1eb3`. Earlier source-only entries below are historical; the latest execution evidence supersedes their unrun-check status only where explicitly recorded. Luna handles implementation/checks; Terra reviews native integration. The overall goal is active and incomplete.

## Latest stop checkpoint — 2026-10-28

The user-requested 5% remaining allowance threshold was reached. All current work and this full next-step plan are committed/pushed; agents are complete and owned native/test processes are stopped. This goal is paused pending a resume request. Four native objects compile (product, product-state, server config, server manager). Next: loader and crash-reporter object checks, full linked browser/sandbox build, native runtime verification, and continued implementation of all remaining features per CONTINUATION_HANDOFF.md and the 103-task plan.


## Remote continuation checkpoint — 2026-10-28

Source work committed on `feat/aster-linux-ui` since `3f701328`: U01 bounded/persistent resizable sidebar; U02 live current-window tabs, real bookmarks and existing conversation history grouped in the Aster rail; U03 local recent task cards with real statuses, safe filtering and recovery markers; and U06/S01 private one-time message/tab handoff with a current-window API boundary. All remain partial until full app and native validation. See [source implementation evidence](evidence/aster-remote-implementation-2026-10-28.md).

**Next implementable batch:** extend sidebar into nested bookmarks and native pane controls; complete task transcript/recovery, approvals, permissions and provider routing. In a source checkout with dependencies, first run focused WXT/React builds and the new sidebar, homepage and handoff tests. Continue compiler work on loader/crash reporter and the linked native binary only on a host with the pinned Chromium checkout. Do not infer those host-local artifacts or processes from GitHub docs. No release signing/update ownership is provisioned. The broader 103-subtask plan remains open.


**Next U09 verification:** compile the new customization card and bootstrap with WXT, test profile persistence, system theme changes, zoom/reduced-motion accessibility on a real extension view and confirm no effects on normal websites. Reduced animation cannot be called a battery optimization until measured. Continue all remaining native, security, agent and release requirements.


## Verified source batch and next implementation — 2026-10-28

[Focused GitHub Actions run 40682050699](https://github.com/puneetdixit200/brower/actions/runs/40682050699) passed extension and server TypeScript, 12 focused tests, and pinned Biome for sidebar, approval and task-export source. The code and [evidence](evidence/aster-feature-batch2-2026-10-28.md) are committed to `feat/aster-linux-ui`. **This is not a working native browser verification.** Full 72-row matrix: 2 PASS, 32 PARTIAL (including S05 blocked), 38 NOT_STARTED.

Next implementation must complete native Chromium loader/linker and Aster window launch against the pinned source, then native tabs/split panes, real provider/model controls, durable non-replaying task recovery, offline/MFA assistance, origin-safe credential boundaries, and the remaining security/routine/memory subtasks. Continue to run focused CI for source additions, and preserve release-signing custody and update ownership as blocked. Do not mark release ready based on this branch alone.


## New source-only foundation checkpoint — 2026-10-28

Of the 38 formerly NOT_STARTED feature rows, 36 received source-level foundations and are now PARTIAL. The canonical matrix reads **2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED, 2 NOT_STARTED**. The latest [implementation evidence](evidence/aster-source-foundations-38-2026-10-28.md) lists changed source, explicit limitations and security boundaries. User requested all tests later, so none of this batch's source was compiled/typechecked or verified in the GUI. Historical passing tests must not be applied to the new commits.

**Next source-critical work:** T30.1 now adds a bounded v1 identity checkpoint to a fresh heartbeat turn in the same conversation after a completed run. The checkpoint contains only validated run/job/conversation IDs, status and timestamps; its no-replay and stop-on-uncertainty instructions are advisory. Implement server-enforced continuation/idempotency that prevents side-effect replay and recovers no expired approvals or leases; do not claim interrupted execution resumes. P03 blind autofill requires a Chromium-native origin-bound credential broker that never exposes vault secrets to LLM content or extension JS; do not mock it by reading saved passwords. Then build the native Aster binary on an eligible pinned-source Linux host and test every partial capability, with particular attention to custom MCP permissions, site recipe integrity, prompt queue races, private-window data, external CLI authentication, screenshots and error states. Complete remaining 103-subtask phases, benchmark against matched upstream, and preserve release-signing/update ownership blocks until actually provisioned.


**Testing-deferred note:** An automatic push workflow on an intermediate commit caught a server TypeScript description-type error; the source was fixed but no follow-up CI run was initiated. The Aster-focused workflow is now manual-dispatch only. Reenable focused CI deliberately before any new PASS claims. See the latest foundation evidence for exact details.

## Historical model policy and 3% stop checkpoint — 2026-10-28

The user selected Terra as the main model and requests **Luna medium subagents only** for implementation and review, with a maximum of five concurrent subagents. Do not delegate work to Sol or Terra subagents. Keep handoffs narrow and conserve tokens. This supersedes older model-policy entries.

Account allowance was already at 3% remaining when this continuation began, below the user's 5% stop threshold. Fetched and fast-forwarded 125 remote commits through `8454a673d`, then stopped at the requested checkpoint. Current source contains a broad unverified foundation batch; the matrix records 2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED and 2 NOT_STARTED. Source foundations are not equivalent to verified feature completion.

Next: resume only when requested and allowance permits. Implement all remaining master-spec features, prioritizing R02 durable heartbeat continuation and P03 origin-bound blind autofill without exposing passwords, alongside completing native loader/crash-reporter compilation, full native browser build and security boundaries. Read CONTINUATION_HANDOFF.md, IMPLEMENTATION_PLAN.md and the latest source-foundation evidence. Run only tests authorized by the current user instruction; record all unverified behavior. Keep release signing/update ownership blocked until provisioned.


## R02/P03 source checkpoint — 2026-10-28 (historical snapshot)

At this earlier checkpoint, the local worktree had source changes for heartbeat task selection/continuation and an Aster-only Autofill deny guard; the R02/P03 changes had not yet been applied to the native checkout. The later superseding update below records that the exact guard/test hunks are now applied and GN regeneration succeeded. Native compilation and browser tests remain pending. The Autofill denial is a safety guard only; P03 remains NOT_STARTED until browser-owned consent and an origin-safe broker exist. Current matrix: **2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED**. Details: [checkpoint evidence](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md).

Inspect native checkout/build process state, stage the reviewed changes through the normal pinned-source pipeline, compile the changed Autofill code and focused DevTools browser-test target, and run that native test. If it passes, continue the two-job native build and launch Aster on a disposable profile. Verify task/heartbeat mode selection, a new task's separate conversation, completed-run heartbeat continuation in the same conversation, failed/interrupted fail-closed behavior with no replay, persistence/restart, nested bookmark-folder drill-down/back/search and private-window behavior, and direct Aster Autofill `list`/`add`/`fill` denials; confirm BrowserOS behavior remains unchanged. Then continue the complete 103-subtask implementation and live feature testing. Do not close native, security, performance, release-signing, update-ownership, or overall-project gates without evidence.

Use Luna medium for implementation, focused checks, and documentation, with independent review as requested. At 5% remaining allowance, checkpoint all source/docs, exact next steps and process state, stop owned test/build processes and agents, push if requested by the active instruction, and pause. The overall goal remains incomplete.

## GitHub refresh and current continuation — 2026-10-28

Fetched `aster/feat/aster-linux-ui`; GitHub had no commits newer than `70060058f`. Current uncommitted work adds U09 validation notes, U13 consent-based lasso screenshot context with activation verification and submit-only LLM/ACP attachment forwarding, U14 fail-closed owner-tab context, and session-pinned Linux `openat2` confinement for read/write/edit/list/find/grep. The descriptor is captured before filesystem tool construction, shared across turns, and closed after active operations drain or construction fails. Find/grep use the workspace root for traversal and reads; bounded reads reject file growth past grep's cap. Filesystem, agent, and ChatService/ACP focused suites pass 452/452; server typecheck, targeted Biome, and diff check pass. Independent review confirmed non-Linux static symlink containment is preserved and found no remaining issue in the scoped changes. Bubblewrap could not bind the server descriptor through `/proc/<pid>/fd`, so Bash remains pathname-bound; non-Linux filesystem helpers retain validation-to-use races. U13/U14 focused checks and independent review pass. S02 remains PARTIAL; matrix remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED (72 total).

**Next:** continue T06 by finding a safe Bubblewrap bind strategy for the pinned directory and resolving non-Linux validation-to-use races; keep S02 PARTIAL until those boundaries and packaged sandbox interaction are covered. U13/U14 remain PARTIAL pending headed permission and native/browser acceptance. Continue the canonical 103-subtask plan, prioritizing native build/runtime gates and remaining MUST features; performance baselines and release ownership remain open. Preserve the dirty native Chromium checkout and stop/checkpoint/push when account allowance reaches 5% remaining.

### T06 follow-up — 2026-10-28

The Linux Bash pathname gap is closed in source: Bun inherits the session-pinned workspace descriptor as stdio fd 3 and Bubblewrap binds `/proc/self/fd/3`. A regression renames the workspace, replaces its former path, and confirms the original inode remains mounted. Focused filesystem/agent/ChatService-ACP/lifecycle tests pass 455/455; server typecheck, targeted Biome, `git diff --check`, and independent Luna review pass. The current remote branch contains `9152baa17` and `a341bd20f`; no fetched updates were ahead of local HEAD `a341bd20f`.

**Next:** resolve non-Linux validation-to-use races and verify confinement in the packaged runtime. Then perform headed permission/browser acceptance for U09/U13/U14, continue all remaining MUST items in the 103-subtask plan, and keep native build, performance, signing, and release gates open until evidenced. S02 remains PARTIAL. Preserve the dirty Chromium checkout and checkpoint/push/stop when the account allowance reaches 5% remaining.

### Superseding U16/P03 update — 2026-10-28

U16 report markdown injection is fixed; focused tests pass 10/10 and the app typecheck passes. The saved prompt, ordered step summaries and saved final response are included in task detail. No headed UI run followed this change. Keep U16 PARTIAL until headed UI, persistence, and safe artifact/download behavior are verified.

P03 remains NOT_STARTED. The exact Aster guard/test hunks have been applied to the native checkout and Aster Debug GN regeneration succeeded; native compilation and browser testing remain pending. A native build is ongoing, with no completion count recorded here. After it finishes, compile the Autofill and focused DevTools test targets, run the browser tests, and verify the Aster-only denials plus unchanged BrowserOS behavior. Before enabling any credential operation, implement the browser-owned broker described in [the Actor Login API review](evidence/aster-p03-actor-login-api-review-2026-10-28.md): bind the live target, profile, main-frame document token and committed origin; hold credential data in native memory; require a fresh browser-owned chooser/consent gesture; revalidate before fill; cancel on navigation/detach/timeout; and return only coarse status. Never expose credential metadata or silently reuse persistent Actor Login permission.

### A05 current source checkpoint — 2026-10-28

The committed A05 lifecycle implementation persists conversation/run identifiers, status and timestamps; startup marks leftover `running` rows `interrupted`; the app fetches and displays the existing transcript without opening a stream; and deletion removes lifecycle plus conversation data. Focused evidence: 63 server tests, 5 app tests, app/server typechecks and targeted Biome, recorded in [A05 lifecycle evidence](evidence/aster-a05-lifecycle-2026-10-28.md). A05 remains PARTIAL: stream/tool state, replay, execution continuation and approval/ownership recovery are absent. The lifecycle transcript flow has no headed or packaged-native restart acceptance; separate task-history visibility smokes verified interruption status only. Next verify actual app/server process restart, transcript display, delete cleanup and no replay, then continue broader recovery and native gates.

### Current batch: R03 reliability, U07 routing, and native build — 2026-10-28

R03 alarm reliability and U07 stored-provider routing have focused tests, typechecks and independent Luna reviews. Both remain PARTIAL pending headed/native acceptance. Evidence: [R03](evidence/aster-r03-daily-alarm-reliability-2026-10-28.md) and [U07](evidence/aster-u07-provider-routing-2026-10-28.md). Continue actual runtime coverage for schedule recovery, timezones, provider/model switching and provider compatibility.

The pinned native checkout has the Aster patch set and the focused Autofill handler and DevTools test translation units compile. The one-job `browser_tests` build stopped cleanly at 621/52,858 actions after slow progress; no linked browser-test binary, native browser launch, or focused browser test has been verified. The stop left the dirty native checkout and generated outputs intact; the final snapshot was 4.8 GiB available RAM, 9.1 GiB swap used, and 267 GiB disk free. Pick a narrower/reusable build plan before another attempt; never report object compilation as browser-test success.

The completion figure is evidence-based: **2/72 matrix features PASS (2.8%)**; the remaining rows are PARTIAL, PARTIAL/BLOCKED, or NOT_STARTED. This is not an effort-weighted estimate because the features and 103 implementation subtasks have different sizes and no validated weighting scheme. Continue the full 103-subtask plan; source foundations do not equal completed features.

### Current continuation — T05.1 permission modes — 2026-10-28

Fetched GitHub remotes; `aster/feat/aster-linux-ui` remains at `a341bd20f` with no newer Aster commit. This checkpoint adds independent Read-only/Guard task permission selection and server enforcement. Focused verification passes 57 server tests and 5 app request tests; app/server typechecks, targeted Biome, diff check, and independent Luna review pass. Full access remains disabled and rejected; ACP Read-only fails closed. No headed or packaged-runtime check has run.

**Next:** persist per-action allow/ask/deny policy (T05.2), exercise approval, denial, expiry, forgery and restart; add local send/post/payment fixtures through the server gate (T05.3), then repeat in a runnable Aster package when T20a is available. Do not enable Full until the platform enforces its claimed browser and filesystem scope. Continue all other MUST work in the 103-subtask plan, including cross-platform filesystem races and native build/runtime gates. Account usage was 68% primary and 26% weekly at the latest check, so continue and checkpoint when only 5% remains.

### Superseding continuation — T05.3 local approval fixtures — 2026-10-28

T05.3 adds deterministic local send/post/payment fixtures through the same production ToolLoopAgent approval callback. Focused fixture tests pass 3/3 with 15 assertions; they use no network or credentials, and only the explicitly approved fixture executes. T05.2 retains its persistent operation-specific Allow/Ask/Deny catalog, trusted local API, settings UI, expiry, chat stale-approval revalidation, BrowserOS MCP enforcement for ACP, and ACP native permission mediation. No headed settings/persistence, packaged Aster runtime, or real built-in ACP mediated request acceptance has been performed. ACP native controls are protocol callbacks, not an OS sandbox for custom processes that bypass permission requests. A09/T05 remains PARTIAL; completion remains 2/72 features PASS (2.8%).

**Next:** verify headed settings behavior and policy persistence across a full app/server restart; then exercise actual mediated write/edit/execute permission requests for built-in ACPs in a packaged Aster runtime on T20a. Keep Full disabled and ACP Read-only rejected until their capability boundary is verified. Continue remaining MUST work in the full 103-subtask plan, including non-Linux filesystem races, native browser linking/runtime, performance baselines, signing, and release ownership. Latest usage check: 82% of the primary window and 29% of the weekly window used; keep working and checkpoint/push all source and docs when any applicable allowance reaches 5% remaining, then stop as requested.

### Superseding T06 evidence and next steps — 2026-10-29

T06.1 passes 3/3 (18 assertions): hostile page text is formatted through real `formatSnapshotResult`, then deterministic send/post/payment proposals reach the production `ToolLoopAgent` approval callback. The evidence shows proposals pause pending server approval; it does not test real-model prompt resistance or external integration wiring. T06.2 adds a descriptor-anchored no-follow POSIX walk; Linux `openat2` is unchanged and Windows fails closed. The helper suite passes 15/15 (41 assertions), and the full filesystem suite passes 173/173 (378 assertions). T06.3's actual Linux Bubblewrap tests check home, `/var/tmp`, and `/run` isolation sentinels; Bash passes 20/20, included in the filesystem total. Server typecheck, targeted Biome, and diff check pass.

The actual macOS/BSD path is unverified, and portable POSIX has a narrow documented `lstat`-to-`open` device-node swap race. Bubblewrap has network egress, and no native Aster runtime/window is available. S01 and S02 remain PARTIAL; overall status remains 2/72 PASS (2.8%). Next: test macOS/BSD if supported or formally scope the implementation to Linux; resolve or accept the device-node race; decide network policy; verify packaged Aster T20a runtime; and complete signed release gates. Continue the remaining 103-subtask plan and other MUST work. Current allowance: 87% of the primary window and 29% of the weekly window used (13% and 71% remaining).

### T19.4 durable trace store follow-up — 2026-10-29

The lifecycle store exposes typed `appendTraceEvent(conversationId, runId, event)` and `getTraceEvents(conversationId, runId)` APIs. Migration `0023_add_conversation_run_trace_events` and the packaged-schema fallback store only strict `AgentTaskTraceEvent` metadata, validate events on write and read, retain at most 500 events per run and 10,000 total, and remove them on conversation deletion. Migration `0024_add_conversation_run_trace_degradation` separately persists the degraded-storage marker exposed by snapshots. `ConversationRuns` appends schema-created events through this store and revalidates conversation/run-scoped events on recovered snapshots. Recovery normalizes orphaned `running` status to `interrupted` and transactionally/idempotently persists one interruption event; both retention caps apply to that insertion. Snapshot responses expose `tracePersistenceDegraded` when trace storage fails, without changing task execution. Latest root-verified results: server 78/78 across seven suites; app 81/81; browser-core/MCP 25/25; server route group 92/92; Python 13/13. App typecheck/build passed (24.1 MB); server typecheck/direct tsc, Biome and diff-check passed. Independent Luna review found no remaining T19.4 issue. Process-restart, live-provider, native-browser and packaged-runtime acceptance remain open.

`AiSdkAgent` validates versioned tool-call and result envelopes around tool execution, replacing provider call IDs with local IDs; input/output payloads pass through unchanged and are not part of the lifecycle trace. No process-restart, live-provider, native-browser or packaged-runtime verification was performed. The feature matrix remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED and 1 NOT_STARTED (72 total).

### Latest focused verification — 2026-10-29

Prepared-resource/unpacked-extension Python tests pass 14/14; native pin/staging, Dev REPL and launcher Python tests pass 19/19 (33/33 across these suites). T19.4 remains verified at 78/78 server tests across seven suites; app tests 81/81, browser-core/MCP 25/25, server route group 92/92 and Python 13/13 also pass. App typecheck/build passes. The read-only exact-object Ninja dry-run, `ninja -C out/Default_aster_x64 -n obj/chrome/browser/devtools/devtools/autofill_handler.o`, hung for 30 seconds after entering the output directory and was interrupted (exit 130); no build or file writes occurred. Native verification remains open. Feature matrix status remains 2/72 PASS (2.8%); no feature is complete from these checks.

### T18.1 optional Chromium import handoff — 2026-10-29

The source now offers a user-triggered handoff to Chromium's `chrome://settings/importData`. Chromium retains ownership of the explicit import choice; native setup owns the profile location, which the extension cannot change. Focused onboarding suites pass 6/6 (53 assertions), with app typecheck and targeted Biome passing. Headed native Aster acceptance has not run; U18 remains PARTIAL and matrix status remains 2/72 PASS (2.8%). Verify the handoff and profile-location boundary in a disposable headed Aster profile when a runnable binary exists.

### T26.1 research source-contract and UI ledger — 2026-10-29

Successful built-in Browser MCP `read` results now include the current page URL in structured output; `navigate` already returns a structured URL. The accessible “Source URL checks” ledger beneath the final research answer matches citation URLs only against successful `read`/`navigate` structured outputs inside that research turn. Exact matching preserves query strings and path case, ignores fragments, and leaves sanitized attached seeds `seed-only` only on exact normalized URL match. Query strings are omitted from displayed URLs; sensitive-looking paths are sanitized using the existing heuristic.

UIMessage parts do not identify their MCP server, so attribution depends on the server-side reserved-name collision filter; a production regression verifies custom tools named `read`/`navigate` cannot replace built-ins. Successful citation URL matches label whether built-in `read` or `navigate` observed the URL in the same research turn. Up to 12 short answer quotes are checked as exact strings against bounded successful `read` text from the exact cited URL; the UI reports found/not found and says this does not prove claim support or truth. Research-request, source-ledger and Browser MCP read tests pass 21/21 (50 assertions); the production collision regression passes 1/1 (3 assertions). App and Browser MCP typechecks, targeted Biome and `git diff --check` pass. A11 remains PARTIAL. Next implement semantic claim-to-source support evidence, then verify with a live provider.

### T26.2 A12 fresh-turn continuation — 2026-10-29

The handoff UI offers “Continue after I’m done” after Stop and takeover. It submits a fresh message to the same conversation, validates attached tabs against the live current window, and falls back to the live active HTTP(S) page. For this continuation only, browser context keeps tab IDs but omits active/selected tab URLs and titles. Its prompt asks the model to inspect current state and avoid repeating the stopped action or requesting/inserting login secrets; that request is advisory, not enforced. The context filter does not establish exclusion of all page-derived data in downstream browser tools. Accepted sends may be queued; rejected sends keep the stopped run stopped and show retry guidance. Focused helper/UI/request-context tests cover prompt, target-page selection and metadata omission. A12 remains PARTIAL: automatic challenge detection, same-run pause/resume, a dummy local challenge fixture, and headed acceptance remain open.


## Current verified source checkpoint — 2026-10-29

The branch has new, focused source changes for R02/R03 and A11. GitHub Actions [40787505020](https://github.com/puneetdixit200/brower/actions/runs/40787505020) passed 19 scheduler tests, app typecheck, Biome and whitespace; [40786688768](https://github.com/puneetdixit200/brower/actions/runs/40786688768) passed 22 research tests and the same checks. The source evidence is recorded in [aster-github-continuation-2026-10-29.md](evidence/aster-github-continuation-2026-10-29.md).

**Next implementation batches:**
1. **T30.2 real restart/overlap fixture:** start a heartbeat with a long-running server tool, restart the extension worker, verify its persisted run is not failed or replayed, then exercise server crash and a verified terminal/missing state. Reconcile the ten-candidate cleanup cap and ensure no hidden side effects; protect server authorization/approval identities. This cannot be declared done from liveness unit tests.
2. **T26.3 research support:** require claim-scoped supporting source text, independent of model narrative; preserve unverified and ambiguity labels and enforce server trust provenance. Add a live-provider research fixture; literal quote presence alone is not support.
3. **T20a native bootstrap:** on a permitted local pinned Chromium checkout, build remaining loader/crash-reporter/linked binaries with low concurrency and verify disposable profile, sandbox, Aster extension READY, sidecar and controls. Cloud GitHub-only source checks cannot substitute for this.
4. Continue all remaining 103 subtasks, full 72-row acceptance tests, performance comparison, privacy/security reviews, release-signing custody and owned update feed. Preserve P03 NOT_STARTED and S05 PARTIAL/BLOCKED without a native credential broker and release ownership.
5. Check the user's **actual account allowance** at batch boundaries using an authorized account meter when available; the current toolset provides no such meter, so no 5%-remaining claim can be made. No Luna subagent execution tool was exposed; do not substitute other models. No local Chromium/test processes or agents were started in this session.

**Status: not complete.** Do not mark more feature rows PASS based on these source-level fixtures.
