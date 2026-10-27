# Aster next steps

Checkpoint: 2026-10-28, branch `feat/aster-linux-ui`. This repository contains the full current source and implementation plan, not a finished browser release. The overall goal remains active and incomplete.

## Next execution order

1. Finish T04 headed verification in a disposable browser profile **and** an explicit disposable `BROWSEROS_DIR`: cross-tab failed revoke, offline error/retry, and sidecar restart persistence. The latest advanced smoke timed out waiting for initial OFF state; resolve the runtime/state or harness discrepancy before claiming this gate. Unit/reducer/real Bun API tests and workspace typechecking pass.
2. Add Aster development resource producers and staging: extension/CRX identity, onboarding resources, and an Aster-owned server bundle. Keep release signing keys, update service and remote ownership as separate unprovisioned release gates; do not substitute BrowserOS resources.
3. Provision the pinned Chromium source and attempt a monitored Linux native build with low concurrency (`BROWSEROS_NINJA_JOBS=2`). Run the new Aster GN/C++ paths, sandbox, profile/extension identity and native telemetry gates in the actual binary. Patch doctor and standalone assertion checks are not native compilation.
4. Test basic browser features and OS integration in that Aster build, then implement remaining sidebar/tab UI, agent permissions/approvals, provider routing, memory, schedules and task recovery from `IMPLEMENTATION_PLAN.md`.
5. Complete package/install/uninstall, security/outbound-data review, performance and lifecycle tests. Promote matrix rows only with matching execution evidence.

## Cost-conscious execution

- Luna medium: routine implementation, focused tests and documentation.
- Terra medium: difficult integration and work that repeatedly fails with Luna.
- Sol: planning and independent batch review; review security-sensitive changes immediately.
- Keep handoffs narrow, reserve file ownership, avoid duplicate investigations and repeat broad checks only after a relevant change or failure.

## Current evidence and limits

- S05 development extension identity, origin/reporter boundaries and headed recovery regression have evidence in `evidence/aster-identity-2026-10-28.json`; release provisioning remains blocked.
- Native Python suite: 1,330 tests run, three skipped. Native patch doctor: 422 patches across 38 features. The actual extracted product assertion was checked with all eight Boolean combinations. No Chromium/GN build or native Aster runtime has been verified.
- T04 source implements default-off private consent, content-free error envelopes, fixed server counters, revoked queue/lease denial, app native-metric suppression, and visible settings. Latest normal headed consent/cross-tab/reload checks pass in isolated state. Advanced error/restart verification remains open.

See `FEATURE_MATRIX.md` for all 72 features and `IMPLEMENTATION_PLAN.md` for 95 subtasks.
