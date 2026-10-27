# Aster unpacked Linux debug source integration — 2026-10-28

## Scope
This checkpoint records source changes committed directly through GitHub on `feat/aster-linux-ui` since `3d4b1052`. The user's local Omarchy checkout and Chromium source tree were **not mounted**. No Bun, Python tests, GN generation, C++ compilation, browser launch, packaging, CPU profiling or security runtime experiments were executed in this session.

## Implemented in source
- An explicit `--aster-unpacked-dev` build flag selects Aster Linux `debug` + `source` only. Planner rejects other products, platforms, release presets, signing and upload. Default source-mode and signed release behavior is retained.
- `Context.get_product_gn_args()` now prevents Aster from inheriting the multi-product BrowserOS debug flags and passes `aster_use_unpacked_dev_extension` into GN.
- New prepared-resource mode `unpacked-dev` records checksummed `product_unpacked_zip` and the Aster onboarding archive, separate from the signed-CRX roles. It builds the WXT development output without signing keys and verifies the dev extension's public identity, version, file-tree boundaries, lack of update URL and default-deny external callers. It must not be confused with a real signed release resource.
- The source-resource steps propagate the explicit build-mode identity; normal source release preparation still requires signed CRX credentials.
- Bundled extension staging extracts and revalidates the unpacked tree and creates a deterministic GN input manifest. An Aster-specific GN action copies it into the native output. Default GN leaves this action disabled.
- The patched native loader initiates `extensions::UnpackedInstaller` only under `BUILDFLAG(ASTER_UNPACKED_DEV_EXTENSION)` and waits for actual registry readiness instead of failing immediately at an empty signed-CRX catalog. This depends on the exact Chromium API and remains **uncompiled/unverified**.
- Aster Linux x64 server and icon resources have product-scoped copy rules, and Aster's asset-copy behavior cannot inherit foreign BrowserOS/BrowserClaw debug assets.
- Signed CRX, update feed, key ownership, release upload and official build validation have **not** been weakened.

## Exact next verification gates (NOT RUN)
1. Update or check a **separate clean local checkout**, verify branch HEAD, uncommitted files and upstream remote. Do not force-reset or overwrite newer work.
2. Build both Aster and BrowserOS onboarding modes, inspect emitted favicon/title and capture actual exit codes.
3. Run the focused Python resource/extension suite (including new resource-mode cases), typecheck and formatter; resolve any failures before claiming a passing build.
4. With a pinned Chromium checkout already available, run:
```sh
cd packages/browseros
export BROWSEROS_NINJA_JOBS=2
uv run browseros build \
  --preset debug --product aster --arch x64 \
  --resource-mode source --aster-unpacked-dev \
  --provision none --no-clean --no-sign --no-upload \
  --chromium-src /ABSOLUTE/PATH/TO/PINNED/CHROMIUM/src
```
   The command is a **candidate based on source inspection**, not a command successfully executed in this session. Check `uv run browseros build --help` and the current source scripts before execution. Stop on resource, patch, GN or compile errors and retain logs. Do not disable sandboxing.
5. Run the actual Aster binary against a disposable profile. Confirm extension ID `oifdmombnijnaiocijiacjhajbnpdlhb`, asynchronous installed/READY state, no CRX fallback, loopback-only sidecar, Aster state dir isolation, and privacy-off/restart behavior.
6. Verify release source mode **still fails closed** when CRX signing keys/feed ownership are absent. Do not create fake credentials or CRXs.

## Outstanding project work
- No native Aster browser has been compiled, installed, launched or accepted on Omarchy.
- Full native packaging and release update infrastructure not provisioned.
- Aster sidebar, true split tabs, task replay/recovery, deeper provider routing, remaining accessibility, memory/routine parity, performance and security acceptance tests remain incomplete where marked in `FEATURE_MATRIX.md`.
- User explicitly asked to leave tests aside in this session. **This does not waive quality gates or justify declaring the project complete**.
