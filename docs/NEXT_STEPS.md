# Aster next steps

Checkpoint: 2026-10-28, branch `feat/aster-linux-ui`. This repository contains the full current source and implementation plan, not a finished browser release. The user explicitly authorized resuming on 2026-10-28. The goal remains incomplete; the prior pause is retained as a historical checkpoint.

## Complete build scope and handoff

**Build every feature**, even when the next agent cannot runtime-test them all. Continue real source implementation with available focused checks, record unavailable verification explicitly, and do not claim PASS from source alone. The full prioritized handoff, native build state, tool commands and 72-feature checklist are in [CONTINUATION_HANDOFF.md](CONTINUATION_HANDOFF.md); the canonical detailed 95-subtask breakdown remains in IMPLEMENTATION_PLAN.md.

## Next execution order

1. Complete local validation of the fetched source-only commits. Both onboarding branding modes now pass emitted title/favicon checks. Verify the new unpacked resource preparation/staging, extension build, native pin gate and incremental staging behavior; retain signed release validation.
2. Pinned Chromium 155.0.8059.26 and Linux sysroot are ready in `../chromium-aster-dev/src`; the Aster patch set is applied. Aster server, loader, crash-reporter, Autofill and focused DevTools test translation units compile. The `browser_tests` target expanded to 52,858 actions; the one-job build was stopped cleanly at 621 actions after slow progress. No linked test/browser binary exists. Preserve build outputs and the dirty native checkout; choose a narrower/reusable native build strategy before restarting.
3. In the actual native binary, verify extension READY/new tab, sandbox, isolated profile/state, sidecar launch/authentication, privacy/restart and tool output. Complete broader provider/log-sink and outbound-data review.
4. Verify the command palette and lazy routes in a disposable runtime. Measure bundle/startup/workload performance before claiming an improvement. Continue the remaining UI/agent/browser subtasks in `IMPLEMENTATION_PLAN.md` against the now-versioned master specification.
5. Complete package/install/uninstall, release signing/update ownership, security, performance and lifecycle gates. Promote feature statuses only with matching evidence.

## Cost-conscious execution

- Use Luna medium for all implementation, focused tests, planning, judging and independent review. Do not use Sol or Terra for project work.
- Deploy no more than five Luna medium subagents at once; keep assignments narrow and file ownership separate.
- Keep handoffs narrow, reserve file ownership, avoid duplicate investigations and repeat broad checks only after a relevant change or failure.

## Current evidence and limits

- S05 development extension identity, origin/reporter boundaries and headed recovery regression have evidence in `evidence/aster-identity-2026-10-28.json`; release provisioning remains blocked.
- Native Python suite: 1,330 tests run, three skipped. Native patch doctor: 422 patches across 38 features. The actual extracted product assertion was checked with all eight Boolean combinations. No Chromium/GN build or native Aster runtime has been verified.
- T04 source implements default-off private consent, content-free error envelopes, fixed server counters, revoked queue/lease denial, app native-metric suppression, and visible settings. Latest normal headed consent/cross-tab/reload checks pass in isolated state. Advanced error/restart verification also passes in explicit disposable state. A portable harness is available under `packages/browseros-agent/scripts/dev/aster_privacy_smoke.py`; the packaged native gate remains open.

See `FEATURE_MATRIX.md` for all 72 features and `IMPLEMENTATION_PLAN.md` for 95 subtasks.

## Requested stop condition

When account usage falls to 5% remaining, commit and push all current work, refresh this next-steps list, stop test processes and agents, and pause the goal until the user requests a resume.

## Latest server milestone

The local-only Linux x64 server archive includes verified Bun 1.4.2 and migration resources. Independent startup returned health OK with CDP connected, telemetry off and isolated Aster state. Python discovery ran 1,333 tests with three skipped; focused builder, state and filesystem checks and workspace typechecking pass. Native Aster browser and packaged MCP output verification remain open.

## User-requested stop checkpoint — 2026-10-28

Commit and push all current source and Markdown now, then stop. Resume only on user request. The new onboarding producer is a development checkpoint; native Aster compilation and launch remain unverified. Next: finish onboarding integration checks, implement the gated unpacked extension development path in `ASTER_NATIVE_DEVELOPMENT_PLAN.md`, then attempt a low-concurrency pinned native build and repeat runtime/privacy checks. Use Luna medium for implementation and Terra for planning/review; reserve Sol for exceptional unresolved cases.


## GitHub-only resume — 2026-10-28

The latest source commits address the Aster onboarding Vite favicon ordering, add brand-specific output validation, defer a prepared-resource import to avoid premature pipeline registration, and add a **read-only** gated unpacked development extension validator plus focused tests. See [the resume checkpoint](evidence/aster-github-resume-2026-10-28.md). These changes were committed to `aster/feat/aster-linux-ui` remotely; this session did **not** run the builds/tests, inspect the user's local working tree, or build native Chromium.

**Immediate next step:** run both onboarding modes and focused Python tests on the user's Omarchy checkout; fix regressions before wiring the unpacked validator through prepared-resource staging, GN flags, and native extension loading. Keep signed-CRX release checks intact. Then attempt the monitored jobs=2 native build and runtime checks. The user-requested earlier pause above is historical, not the current instruction.


## Source-only unpacked debug integration — 2026-10-28

The GitHub branch now contains a gated `--aster-unpacked-dev` source/build-planner path, resource ZIP verification/staging, a GN staging action, an Aster-only asynchronous unpacked loader branch, and product-owned server/icon rules. See [evidence checkpoint](evidence/aster-unpacked-integration-source-only-2026-10-28.md). **These changes have not been compiled, tested or run on Omarchy.** Preserve all previous feature statuses. Run the focused integration and build commands in the checkpoint once local Chromium is accessible, fix actual failures, then continue the 95 implementation subtasks. Release keys/update-service ownership, full browser UI parity, native packaged checks, performance and security gates remain open.


## Next checkpoint — source implementation and UX (2026-10-28)

The [master build specification](OMARCHY_ASIDE_INSPIRED_BROWSER_MASTER_BUILD_SPEC.md) now lives in this repository. The latest source-only work adds a dedicated WXT debug build, GN metadata staging, a guarded native build driver, an opt-in Omarchy launcher, an Aster route command palette, and CPU/RSS sampling. See [checkpoint evidence](evidence/aster-source-development-2026-10-28.md). No native binary or runtime parity is verified.

**Next critical blocker:** on the actual Omarchy host, reconcile local working-tree changes without force-resetting. Run the prepared-resource builds, apply native patch mapping, generate GN against the pinned Chromium checkout, and compile with jobs=2; fix any compile/API or packaging errors. Only then can the command palette, extension READY, split view, sandbox/state, sidecar, privacy and performance be validated in an actual Aster binary. Finish remaining UI/agent/security tasks in `IMPLEMENTATION_PLAN.md`. Keep all signing/update resources unclaimed until provisioned.


**Performance next action:** compile the route-split extension and compare initial JS transfer/parse against its pre-splitting revision, then use `aster_perf_sample.py` with matching idle workloads. Confirm that lazy settings routes open normally and chat-session context is not lost. No performance result has been measured so far.

## Local verification resumed — 2026-10-28

Fetched 66 remote commits and fast-forwarded cleanly from `fd3e59910` to `179ef1eb3`. Earlier source-only entries below are historical; the latest execution evidence supersedes their unrun-check status only where explicitly recorded. Luna handles implementation/checks; Terra reviews native integration. The overall goal is active and incomplete.

## Latest stop checkpoint — 2026-10-28

The user-requested 5% remaining allowance threshold was reached. All current work and this full next-step plan are committed/pushed; agents are complete and owned native/test processes are stopped. This goal is paused pending a resume request. Four native objects compile (product, product-state, server config, server manager). Next: loader and crash-reporter object checks, full linked browser/sandbox build, native runtime verification, and continued implementation of all remaining features per CONTINUATION_HANDOFF.md and the 95-task plan.


## Remote continuation checkpoint — 2026-10-28

Source work committed on `feat/aster-linux-ui` since `3f701328`: U01 bounded/persistent resizable sidebar; U02 live current-window tabs, real bookmarks and existing conversation history grouped in the Aster rail; U03 local recent task cards with real statuses, safe filtering and recovery markers; and U06/S01 private one-time message/tab handoff with a current-window API boundary. All remain partial until full app and native validation. See [source implementation evidence](evidence/aster-remote-implementation-2026-10-28.md).

**Next implementable batch:** extend sidebar into nested bookmarks and native pane controls; complete task transcript/recovery, approvals, permissions and provider routing. In a source checkout with dependencies, first run focused WXT/React builds and the new sidebar, homepage and handoff tests. Continue compiler work on loader/crash reporter and the linked native binary only on a host with the pinned Chromium checkout. Do not infer those host-local artifacts or processes from GitHub docs. No release signing/update ownership is provisioned. The broader 95-subtask plan remains open.


**Next U09 verification:** compile the new customization card and bootstrap with WXT, test profile persistence, system theme changes, zoom/reduced-motion accessibility on a real extension view and confirm no effects on normal websites. Reduced animation cannot be called a battery optimization until measured. Continue all remaining native, security, agent and release requirements.


## Verified source batch and next implementation — 2026-10-28

[Focused GitHub Actions run 40682050699](https://github.com/puneetdixit200/brower/actions/runs/40682050699) passed extension and server TypeScript, 12 focused tests, and pinned Biome for sidebar, approval and task-export source. The code and [evidence](evidence/aster-feature-batch2-2026-10-28.md) are committed to `feat/aster-linux-ui`. **This is not a working native browser verification.** Full 72-row matrix: 2 PASS, 32 PARTIAL (including S05 blocked), 38 NOT_STARTED.

Next implementation must complete native Chromium loader/linker and Aster window launch against the pinned source, then native tabs/split panes, real provider/model controls, durable non-replaying task recovery, offline/MFA assistance, origin-safe credential boundaries, and the remaining security/routine/memory subtasks. Continue to run focused CI for source additions, and preserve release-signing custody and update ownership as blocked. Do not mark release ready based on this branch alone.


## New source-only foundation checkpoint — 2026-10-28

Of the 38 formerly NOT_STARTED feature rows, 36 received source-level foundations and are now PARTIAL. The canonical matrix reads **2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED, 2 NOT_STARTED**. The latest [implementation evidence](evidence/aster-source-foundations-38-2026-10-28.md) lists changed source, explicit limitations and security boundaries. User requested all tests later, so none of this batch's source was compiled/typechecked or verified in the GUI. Historical passing tests must not be applied to the new commits.

**Next source-critical work:** R02 heartbeat continuation must persist original run/conversation/tool identity and resume without replaying side effects or expired approvals. P03 blind autofill requires a Chromium-native origin-bound credential broker that never exposes vault secrets to LLM content or extension JS; do not mock it by reading saved passwords. Then build the native Aster binary on an eligible pinned-source Linux host and test every partial capability, with particular attention to custom MCP permissions, site recipe integrity, prompt queue races, private-window data, external CLI authentication, screenshots and error states. Complete remaining 95-subtask phases, benchmark against matched upstream, and preserve release-signing/update ownership blocks until actually provisioned.


**Testing-deferred note:** An automatic push workflow on an intermediate commit caught a server TypeScript description-type error; the source was fixed but no follow-up CI run was initiated. The Aster-focused workflow is now manual-dispatch only. Reenable focused CI deliberately before any new PASS claims. See the latest foundation evidence for exact details.

## Historical model policy and 3% stop checkpoint — 2026-10-28

The user selected Terra as the main model and requests **Luna medium subagents only** for implementation and review, with a maximum of five concurrent subagents. Do not delegate work to Sol or Terra subagents. Keep handoffs narrow and conserve tokens. This supersedes older model-policy entries.

Account allowance was already at 3% remaining when this continuation began, below the user's 5% stop threshold. Fetched and fast-forwarded 125 remote commits through `8454a673d`, then stopped at the requested checkpoint. Current source contains a broad unverified foundation batch; the matrix records 2 PASS, 67 PARTIAL, 1 PARTIAL/BLOCKED and 2 NOT_STARTED. Source foundations are not equivalent to verified feature completion.

Next: resume only when requested and allowance permits. Implement all remaining master-spec features, prioritizing R02 durable heartbeat continuation and P03 origin-bound blind autofill without exposing passwords, alongside completing native loader/crash-reporter compilation, full native browser build and security boundaries. Read CONTINUATION_HANDOFF.md, IMPLEMENTATION_PLAN.md and the latest source-foundation evidence. Run only tests authorized by the current user instruction; record all unverified behavior. Keep release signing/update ownership blocked until provisioned.


## Current uncommitted R02/P03 checkpoint — 2026-10-28

At this earlier checkpoint, the local worktree had source changes for heartbeat task selection/continuation and an Aster-only Autofill deny guard; the R02/P03 changes had not yet been applied to the native checkout. The later superseding update below records that the exact guard/test hunks are now applied and GN regeneration succeeded. Native compilation and browser tests remain pending. The Autofill denial is a safety guard only; P03 remains NOT_STARTED until browser-owned consent and an origin-safe broker exist. Current matrix: **2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED**. Details: [checkpoint evidence](evidence/aster-r02-p03-source-checkpoint-2026-10-28.md).

Inspect native checkout/build process state, stage the reviewed changes through the normal pinned-source pipeline, compile the changed Autofill code and focused DevTools browser-test target, and run that native test. If it passes, continue the two-job native build and launch Aster on a disposable profile. Verify task/heartbeat mode selection, a new task's separate conversation, completed-run heartbeat continuation in the same conversation, failed/interrupted fail-closed behavior with no replay, persistence/restart, nested bookmark-folder drill-down/back/search and private-window behavior, and direct Aster Autofill `list`/`add`/`fill` denials; confirm BrowserOS behavior remains unchanged. Then continue the complete 95-subtask implementation and live feature testing. Do not close native, security, performance, release-signing, update-ownership, or overall-project gates without evidence.

Use Luna medium for implementation, focused checks, and documentation, with independent review as requested. At 5% remaining allowance, checkpoint all source/docs, exact next steps and process state, stop owned test/build processes and agents, push if requested by the active instruction, and pause. The overall goal remains incomplete.

## GitHub refresh and current continuation — 2026-10-28

Fetched `aster/feat/aster-linux-ui`; GitHub had no commits newer than `70060058f`. Current uncommitted work adds U09 validation notes, U13 consent-based lasso screenshot context with activation verification and submit-only LLM/ACP attachment forwarding, U14 fail-closed owner-tab context, and session-pinned Linux `openat2` confinement for read/write/edit/list/find/grep. The descriptor is captured before filesystem tool construction, shared across turns, and closed after active operations drain or construction fails. Find/grep use the workspace root for traversal and reads; bounded reads reject file growth past grep's cap. Filesystem, agent, and ChatService/ACP focused suites pass 452/452; server typecheck, targeted Biome, and diff check pass. Independent review confirmed non-Linux static symlink containment is preserved and found no remaining issue in the scoped changes. Bubblewrap could not bind the server descriptor through `/proc/<pid>/fd`, so Bash remains pathname-bound; non-Linux filesystem helpers retain validation-to-use races. U13/U14 focused checks and independent review pass. S02 remains PARTIAL; matrix remains 2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED (72 total).

**Next:** continue T06 by finding a safe Bubblewrap bind strategy for the pinned directory and resolving non-Linux validation-to-use races; keep S02 PARTIAL until those boundaries and packaged sandbox interaction are covered. U13/U14 remain PARTIAL pending headed permission and native/browser acceptance. Continue the canonical 95-subtask plan, prioritizing native build/runtime gates and remaining MUST features; performance baselines and release ownership remain open. Preserve the dirty native Chromium checkout and stop/checkpoint/push when account allowance reaches 5% remaining.

### Superseding U16/P03 update — 2026-10-28

U16 report markdown injection is fixed; focused tests pass 10/10 and the app typecheck passes. The saved prompt, ordered step summaries and saved final response are included in task detail. No headed UI run followed this change. Keep U16 PARTIAL until headed UI, persistence, and safe artifact/download behavior are verified.

P03 remains NOT_STARTED. The exact Aster guard/test hunks have been applied to the native checkout and Aster Debug GN regeneration succeeded; native compilation and browser testing remain pending. A native build is ongoing, with no completion count recorded here. After it finishes, compile the Autofill and focused DevTools test targets, run the browser tests, and verify the Aster-only denials plus unchanged BrowserOS behavior. Before enabling any credential operation, implement the browser-owned broker described in [the Actor Login API review](evidence/aster-p03-actor-login-api-review-2026-10-28.md): bind the live target, profile, main-frame document token and committed origin; hold credential data in native memory; require a fresh browser-owned chooser/consent gesture; revalidate before fill; cancel on navigation/detach/timeout; and return only coarse status. Never expose credential metadata or silently reuse persistent Actor Login permission.

### A05 current source checkpoint — 2026-10-28

The committed A05 lifecycle implementation persists conversation/run identifiers, status and timestamps; startup marks leftover `running` rows `interrupted`; the app fetches and displays the existing transcript without opening a stream; and deletion removes lifecycle plus conversation data. Focused evidence: 63 server tests, 5 app tests, app/server typechecks and targeted Biome, recorded in [A05 lifecycle evidence](evidence/aster-a05-lifecycle-2026-10-28.md). A05 remains PARTIAL: stream/tool state, replay, execution continuation and approval/ownership recovery are absent, and no headed or packaged-native restart acceptance was run. Next verify actual app/server process restart, transcript display, delete cleanup and no replay, then continue broader recovery and native gates.

### Current batch: R03 reliability, U07 routing, and native build — 2026-10-28

R03 alarm reliability and U07 stored-provider routing have focused tests, typechecks and independent Luna reviews. Both remain PARTIAL pending headed/native acceptance. Evidence: [R03](evidence/aster-r03-daily-alarm-reliability-2026-10-28.md) and [U07](evidence/aster-u07-provider-routing-2026-10-28.md). Continue actual runtime coverage for schedule recovery, timezones, provider/model switching and provider compatibility.

The pinned native checkout has the Aster patch set and the focused Autofill handler and DevTools test translation units compile. The one-job `browser_tests` build stopped cleanly at 621/52,858 actions after slow progress; no linked browser-test binary, native browser launch, or focused browser test has been verified. The stop left the dirty native checkout and generated outputs intact; the final snapshot was 4.8 GiB available RAM, 9.1 GiB swap used, and 267 GiB disk free. Pick a narrower/reusable build plan before another attempt; never report object compilation as browser-test success.

The completion figure is evidence-based: **2/72 matrix features PASS (2.8%)**; the remaining rows are PARTIAL, PARTIAL/BLOCKED, or NOT_STARTED. This is not an effort-weighted estimate because the features and 95 implementation subtasks have different sizes and no validated weighting scheme. Continue the full 95-subtask plan; source foundations do not equal completed features.
