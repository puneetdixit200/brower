# Aster next steps

Checkpoint: 2026-10-28, branch `feat/aster-linux-ui`. This repository contains the full current source and implementation plan, not a finished browser release. The overall goal is paused at the user's request and remains incomplete.

## Next execution order

1. Fix the emitted Aster onboarding favicon (still BrowserOS), verify the prepared-resource provider mapping and rerun both branding modes, then implement extension development resources and staging. The proposed debug-only unpacked extension path is detailed in `ASTER_NATIVE_DEVELOPMENT_PLAN.md`; signed release remains blocked on real signing custody and feed provisioning. The Aster-owned server bundle is implemented and development-startup verified; see `ASTER_SERVER_DEVELOPMENT.md`. Keep release signing keys, update service and remote ownership as separate unprovisioned release gates; do not substitute BrowserOS product resources.
2. Provision the pinned Chromium source and attempt a monitored Linux native build with low concurrency (`BROWSEROS_NINJA_JOBS=2`). Run the new Aster GN/C++ paths, sandbox, profile/extension identity and native telemetry gates in the actual binary. Patch doctor and standalone assertion checks are not native compilation.
3. Repeat privacy, identity and restart checks in that actual Aster runtime. Development BrowserOS extension/sidecar checks now pass, including failed revoke, offline retry, cross-tab state, persisted ON/OFF, 0600 state permissions and rejected untrusted origins. Complete the broader provider/log-sink and outbound-data review.

4. Test basic browser features and OS integration in that Aster build, then implement remaining sidebar/tab UI, agent permissions/approvals, provider routing, memory, schedules and task recovery from `IMPLEMENTATION_PLAN.md`.
5. Complete package/install/uninstall, security/outbound-data review, performance and lifecycle tests. Promote matrix rows only with matching execution evidence.

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
