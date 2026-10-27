# Aster native development path

Planning checkpoint: 2026-10-28. Terra inspected the existing Python source-resource pipeline and native extension loader. This path is **proposed, not implemented or compiled**. It does not replace the release requirements.

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

A partial first step now exists at `bos_build/release/extensions/aster_unpacked_dev.py`, with `aster_unpacked_dev_test.py`. It implements a **read-only** identity, manifest, file-tree and request-mode validator and has no effect on the existing signed release path. These are committed source changes, not runtime-verified tests in this session. The validator is **not** yet called by `steps/resources/source.py`, `prepared_resources.py`, GN or C++ loader. Explicit debug-only prepared-resource roles, path staging, GN input/copy lists, the native unpacked loader, and the native test remain open. See [resume evidence](../../../docs/evidence/aster-github-resume-2026-10-28.md).
