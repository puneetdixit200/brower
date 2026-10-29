# Aster native development path

Planning checkpoint: 2026-10-28. Terra inspected the existing Python source-resource pipeline and native extension loader. The original path was proposed at this checkpoint. Later 2026-10-28 GitHub source commits implemented much of its Python resource/GN/native-loader wiring, but **nothing has been compiled or runtime-tested**. It does not replace the release requirements.

## Why the current source build stops

Aster's public development manifest key has the stable extension ID `oifdmombnijnaiocijiacjhajbnpdlhb`. No matching private signing key has been supplied. The ordinary source/prepared-resource validators require a signed CRX with the expected ID and complete resource roles, and the current native installer accepts CRX files. Aster's GN extension bundle also requires the CRX file. Renaming a ZIP or inventing a signature cannot satisfy this boundary.

## Implementation sequence

1. Add a distinct Aster debug-resource request/manifest, permitted only for Aster Linux debug, non-official builds. Build the existing app with WXT and its fixed public development key. Validate manifest version, key-derived ID and a complete regular-file tree, then stage under a distinct unpacked development path. Preserve strict signed source/release validation.
2. Carry that explicit development request through `steps/resources/source.py`, `steps/resources/resources.py` (including `stage_prepared_onboarding`) and server preparation/component-version lookup. These currently invoke the strict common-resource validator, so a WXT build or launch flag alone does not unblock source staging. Stage the Aster server and onboarding resources independently.
3. Add a native GN flag, default false, asserted to require Aster, `is_debug` and `!is_official_build`; generate the corresponding C++ buildflag. Only this mode may omit the Aster CRX and copy the validated unpacked tree through a deterministic GN input list/copy target. Do not create a CRX placeholder.
4. Add the build-flag-guarded native unpacked loader. Confirm the pinned Chromium UnpackedInstaller API and UI-sequence requirements before coding. Await extension readiness and verify its actual ID; do not fail provider discovery merely because CRX discovery was empty while the unpacked load was pending. Missing/invalid bundles fail closed, with no BrowserOS extension fallback.
5. Produce the pinned native build at monitored low concurrency, then exercise clean-profile startup and the Aster new tab without manual `--load-extension`. Verify extension readiness, own profile/state, loopback/authentication and server launch. Repeat privacy/restart and tool-output checks in that runtime.

Candidate code seams include `bos_build/release/extensions/`, `bos_build/steps/resources/{source,resources}.py`, product/context planning, and the patch mappings for `browseros/buildflags.gni`, `bundled_extensions/BUILD.gn`, extension loader/installer and provider readiness. Exact mode and flag names must be chosen during implementation; none of the proposed CLI options exist yet.

## Required acceptance evidence

- Explicit dev request allowed only under the supported product/platform/debug/non-official combination; release never accepts the unpacked route.
- Missing, wrong-key, wrong-ID, wrong-version and unsafe file trees rejected.
- Existing BrowserOS/BrowserClaw and signed-resource validations preserved.
- Native GN generation and C++ compile against the pinned checkout, followed by actual extension READY/new-tab launch and sandbox/profile tests.

## Release remains separate

A release needs a provisioned private signing key, the matching public extension identity and an independently provisioned HTTPS update feed/configuration. If the release key derives a different ID, update all product, manifest, native loader and server-origin identities deliberately and verify them together. The development public key is not evidence of release signing custody. The development route must never silently enable itself in an official/release build.


## Implementation checkpoint — 2026-10-28

A partial first step now exists at `bos_build/release/extensions/aster_unpacked_dev.py`, with `aster_unpacked_dev_test.py`. It implements a **read-only** identity, manifest, file-tree and request-mode validator and has no effect on the existing signed release path. These are committed source changes, not runtime-verified tests in this session. The validator is **not** yet called by `steps/resources/source.py`, `prepared_resources.py`, GN or C++ loader. Explicit debug-only prepared-resource roles, path staging, GN input/copy lists, the native unpacked loader, and the native test remain open. See [resume evidence](evidence/aster-github-resume-2026-10-28.md).


## Subsequent implementation, not yet verified — 2026-10-28

GitHub commits on `feat/aster-linux-ui` implement a build CLI switch `--aster-unpacked-dev`, Linux/debug/source planner checks, `unpacked-dev` prepared resource roles, safe unpacked ZIP/file-tree validation, product-owned resource staging, a generated GN source list and debug-only GN copy action. Native loader patches attempt `extensions::UnpackedInstaller` asynchronously behind `ASTER_UNPACKED_DEV_EXTENSION` and wait for primary READY. These are uncompiled hypotheses until checked with the repository's pinned Chromium version. See [source checkpoint](evidence/aster-unpacked-integration-source-only-2026-10-28.md).

**Never call this done based on the GitHub commit alone.** Verify both onboarding brands, Python tests, patch apply/doctor, GN generation, C++ compilation and headed runtime as described above. The signed-CRX/release signing requirements are unaffected.

## Current native-build checkpoint — 2026-10-29

The neighboring checkout at `/home/puneet/Projects/aster-browser/chromium-aster-dev/src` has generated Aster debug GN args and `out/Default_aster_x64/build.ninja` plus `.ninja_deps`, but no linked `chrome` or `browseros` executable and no `.ninja_log`. The system Ninja is 1.13.2; the pinned Chromium checkout includes Ninja 1.12.1. A read-only query of `components/crash/core/app:chrome_crashpad_handler` completed in 40.4 seconds; an interactive GDB sample showed Ninja spending time in `ManifestParser::Parse` / `ParseFileInclude`, consistent with parsing the oversized generated graph, rather than waiting on an external lock. The output tree has 14,252 `.ninja` files totaling 2.94 GB. The matching `-n` dry run completed in 38.9 seconds and planned 3,017 actions, consistent with the missing build log making the target graph appear dirty. A bounded `strace` was unavailable; GDB was used and the process was terminated after sampling. No build or GN regeneration was started. A search under `/home/puneet/Projects/aster-browser` found no `.ninja_log` copy. The checkout has 319 modified paths that belong to its existing Aster patch/build state; preserve them and do not clean or reset it.

T20a is no longer an unexplained Ninja startup hang: loading this graph takes about 40 seconds and the missing build log produces a 3,017-action dry run for the crash-handler target. A dry run of the Aster-relevant `obj/chrome/browser/extensions/extensions/external_provider_impl.o` target also completed, but planned 12,115 actions. Do not start either rebuild or regenerate GN. The missing log makes even a single changed translation unit depend on a broad set of generated and compiled outputs, so native build remains gated on a safe way to recover or reconstruct incremental state. No build outputs changed. Native compile/link and clean-profile extension READY, new-tab, sidecar authentication, profile/state isolation, privacy/restart and tool-output acceptance remain open; no native runtime behavior is verified.

## Build-command follow-up — 2026-10-30

The build command now accepts `BROWSEROS_NINJA_BINARY` as an explicit absolute, regular executable path, passed as one argv item. This permits selecting the pinned in-tree Ninja when the depot_tools wrapper cannot bootstrap; unset configuration retains autoninja. Individual-target builds now receive the same depot_tools environment as the main compile step. The focused `bos_build.steps.compile.standard_test` suite passes 23/23 and independent review found no actionable issue. These are command-construction tests, not native compilation.

Read-only host inspection still finds 283 modified and 36 untracked native paths, no `.ninja_log` or linked browser, 14 GiB RAM (4.9 GiB available), and 262 GiB free storage. No native build, GN regeneration or graph dry-run was started. The override does not establish artifact provenance or remove the incremental-state and resource gates.

The current B03 API source/header/IDL and histogram enum were subsequently staged only into temporary output. The pinned API generator and clang 24 syntax check passed for `browser_os_api.cc`; the native HEAD/status fingerprint was unchanged. This reuses existing generated dependencies/PCM and produces no object or linked browser. Exact argv, staging script, source hashes and limits are retained in [syntax evidence](evidence/aster-b03-syntax-2026-10-30.json). B03/T20a remain PARTIAL pending actual compilation/link/runtime evidence.
