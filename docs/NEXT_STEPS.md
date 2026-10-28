# Aster next steps

Checkpoint: 2026-10-28, branch `feat/aster-linux-ui`. This repository contains the full current source and implementation plan, not a finished browser release. The user explicitly authorized resuming on 2026-10-28. The goal remains incomplete; the prior pause is retained as a historical checkpoint.

## Next execution order

1. Complete local validation of the fetched source-only commits. Both onboarding branding modes now pass emitted title/favicon checks. Verify the new unpacked resource preparation/staging, extension build, native pin gate and incremental staging behavior; retain signed release validation.
2. Pinned Chromium 155.0.8059.26 and Linux sysroot are ready in `../chromium-aster-dev/src`; all 424 patches have applied. Actual GN generation passes (35,759 targets); finish the active changed-object preflight, resume the full build, and compile with `BROWSEROS_NINJA_JOBS=2`. Source preparation and patch doctor are not native compilation.
3. In the actual native binary, verify extension READY/new tab, sandbox, isolated profile/state, sidecar launch/authentication, privacy/restart and tool output. Complete broader provider/log-sink and outbound-data review.
4. Verify the command palette and lazy routes in a disposable runtime. Measure bundle/startup/workload performance before claiming an improvement. Continue the remaining UI/agent/browser subtasks in `IMPLEMENTATION_PLAN.md` against the now-versioned master specification.
5. Complete package/install/uninstall, release signing/update ownership, security, performance and lifecycle gates. Promote feature statuses only with matching evidence.

## Cost-conscious execution

- Luna medium: routine implementation, focused tests and documentation.
- Terra medium: primary planning, judging and independent review; difficult integration and work that repeatedly fails with Luna.
- Sol: exceptional unresolved cases only, after Terra cannot resolve them.
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
