# Build and run on Omarchy

## Verified on the target host

- Omarchy 4.0.6, Arch Linux x86_64, Hyprland/Wayland, AMD Lucienne iGPU, 14 GiB RAM.
- Official BrowserOS v0.51.0 x64 AppImage checksum verified and run in an isolated profile. It rendered under Wayland/Ozone with AMD/Mesa acceleration.
- Bun 1.4.2 installed under `/home/puneet/.local/bin`; frozen dependency installation passed.
- Bubblewrap 0.13.1 is available at `/usr/bin/bwrap`; Linux `filesystem_bash` now fails closed without it and confines shell access to the selected workspace.
- Go 1.27.3 installed user-locally; `go test ./...` passes for the dev supervisor. The Linux runner accepts `ASTER_BROWSER_BINARY` or `BROWSEROS_BINARY`, with `browseros` on PATH as fallback.
- WXT development extension build passed with `NODE_OPTIONS=--max-old-space-size=4096`; output is `packages/browseros-agent/apps/app/dist/chrome-mv3-dev`.
- No full Chromium build has run. Rechecked resources are 14 GiB physical RAM, 29 GiB swap, 12 CPUs and about 288 GiB free disk. Below-recommended RAM is a resource risk rather than an automatic impossibility: the pinned compile step supports `BROWSEROS_NINJA_JOBS=2` for a supervised future trial. Aster GN/C++, server and extension resource integration must be ready first. Keep Chromium sandboxing enabled; no `--no-sandbox` workaround is permitted.

## Current local development commands

From `packages/browseros-agent` as user `puneet`:

```bash
bun install --frozen-lockfile
bun run check
NODE_OPTIONS=--max-old-space-size=4096 bun run build:agent:dev
bun test apps/server/tests/main.test.ts
```

The full upstream test suite currently has known failures; see [`PROGRESS.md`](PROGRESS.md). Linux binary resolution is implemented, but the AppImage-backed server integration test currently exits before CDP startup in its helper mode.

For the live Linux dev flow, see [`packages/browseros-agent/tools/dev/linux/README.md`](../packages/browseros-agent/tools/dev/linux/README.md). The tested entrypoint is `ASTER_BROWSER_BIN=/path/to/BrowserOS.AppImage ./tools/dev/linux/run.sh` from `packages/browseros-agent`.

## Not ready for installation

There is no Aster browser binary, package, desktop entry, installer, or release feed. Do not point a daily profile at this development extension. Packaging work must use a dedicated Aster profile, retain Chromium sandboxing and upstream license notices, and remove BrowserOS extension IDs/update-feed wiring before distribution.


## Experimental Aster source/debug build path (unverified)

The source branch includes a separate **unpacked development extension** route. It is intentionally different from signed release and must not be used to ship an official browser. The following is a candidate command, **not an executed or verified build**:

```sh
cd /home/puneet/Projects/aster-browser/upstream-browseros
# Inspect before syncing: preserve local and newer commits.
git status --short --branch
git fetch aster feat/aster-linux-ui
git log --oneline --left-right HEAD...aster/feat/aster-linux-ui
# Only fast-forward if the checkout is clean and has no divergent work:
git merge --ff-only aster/feat/aster-linux-ui

cd packages/browseros
export BROWSEROS_NINJA_JOBS=2
uv run browseros build --preset debug --product aster --arch x64 \
  --resource-mode source --aster-unpacked-dev --provision none \
  --no-clean --no-sign --no-upload \
  --chromium-src /ABSOLUTE/PATH/TO/PINNED/CHROMIUM/src
```

The Chromium source checkout is large, and 14 GiB RAM may cause the native build to be resource-constrained even at jobs=2. Do not pretend a source commit or GN doctor demonstrates a working packaged browser. Capture output and fix actual errors. The debug extension is intentionally unpacked and uses stable ID `oifdmombnijnaiocijiacjhajbnpdlhb`; do not generate fake signing keys or release feeds. See [source integration evidence](evidence/aster-unpacked-integration-source-only-2026-10-28.md).


## Safer native build and Omarchy developer utilities (source-only)

After reviewing and synchronizing `aster/feat/aster-linux-ui` without overwriting local work, use the monorepo's checked-in driver rather than pasting a long command directly:

```sh
cd /home/puneet/Projects/aster-browser/upstream-browseros
# Existing pinned Chromium checkout is expected at the path below.
python3 packages/browseros/scripts/aster_native_debug_build.py \
  --chromium-src /ABSOLUTE/PATH/TO/PINNED/CHROMIUM/src --jobs 2
# The same driver can provision shallowly when explicitly requested:
# python3 packages/browseros/scripts/aster_native_debug_build.py \
#   --chromium-src /ABSOLUTE/PATH/TO/PINNED/CHROMIUM/src \
#   --provision shallow --jobs 2
```

The driver checks for a clean `feat/aster-linux-ui` checkout, minimum free disk, the Linux host, and required commands, then captures the actual build exit code and writes logs under the user's XDG state folder. It never force-resets Git, kills unrelated processes, or switches off the Chromium sandbox. It **has not been executed successfully** in this session.

Only after an Aster debug binary is actually built and its path verified, the optional desktop entry can be installed:

```sh
python3 packages/browseros/scripts/install_omarchy_aster_launcher.py install \
  --binary /ABSOLUTE/PATH/TO/BUILT/ASTER/BINARY
# Removes the managed desktop entry, not your debug profile:
python3 packages/browseros/scripts/install_omarchy_aster_launcher.py uninstall
```

Once running, record numeric memory/CPU benchmarks with a real browser PID:

```sh
python3 packages/browseros/scripts/aster_perf_sample.py \
  --pid ACTUAL_BROWSER_PID --label aster --seconds 60
```

This sampler captures numeric process-tree CPU/RSS only, not browser startup readiness, page paint time or UI latency. Compare to stock BrowserOS on the **same machine and workload** before declaring a speed improvement.
