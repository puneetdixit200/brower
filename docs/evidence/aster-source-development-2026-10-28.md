# Aster GitHub-only development checkpoint

## 2026-10-28 source implementation update (GitHub-only, no build/test run)

This session extends Aster's source code and master specification in
`feat/aster-linux-ui` without access to the user's local Omarchy checkout.
No native Chromium binary, packaged Aster launch, test or benchmark result is
claimed. The user asked to skip test execution in this pass; quality gates are
still required before publication.

**Commits and code added:**
- `build:aster-unpacked` uses WXT directly rather than the ordinary
  `.env.development`-driven agent build. Python prepares the development ZIP
  with empty release updater/reporter signing-related values and rejects
  mismatched manifests.
- A guarded, jobs-limited Linux native-build driver:
  `packages/browseros/scripts/aster_native_debug_build.py`.
- An explicitly user-scoped Omarchy debug launcher installer/uninstaller:
  `packages/browseros/scripts/install_omarchy_aster_launcher.py`. Its own
  profile is retained at uninstall; no system settings, default browser or
  other installed browser profiles are changed.
- The native debug GN action now stages an empty `bundled_extensions.json`
  beside the unpacked extension, so CRX catalog discovery has a valid,
  deliberately empty response instead of a missing-file warning.
- A route-only Aster command palette accessed with Ctrl+Alt+K (macOS
  Meta+Option+K), and a sidebar fallback button. It does not override the
  existing Ctrl+Shift+K LLM chat shortcut or invoke privileged browser tools.
  No frontend build/test was run, so keyboard and UI integration is partial.
- `packages/browseros/scripts/aster_perf_sample.py` collects process-tree
  Linux CPU/RSS traces. It does not measure rendered-frame/input latency and
  its RSS sum double-counts shared pages.
- The original `OMARCHY_ASIDE_INSPIRED_BROWSER_MASTER_BUILD_SPEC.md` has
  been versioned under `docs/` for complete project requirements.

**Critical unverified steps:** GitHub-only source changes from this and the
previous session need clean checkout reconciliation, WXT typecheck/build,
Python resource validation, GN generation and full C++ compilation. Then
run Aster on a disposable profile with extension readiness, sandbox,
isolated-state, privacy, restart, multi-tab and native packaging verification.
Release signing/key custody and the update service are not configured.

**No completion claim:** Aside feature parity, actual performance and
release readiness remain OPEN. See the full feature matrix for individual
capability state.
