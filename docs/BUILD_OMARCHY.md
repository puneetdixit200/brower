# Build and run on Omarchy

## Verified on the target host

- Omarchy 4.0.6, Arch Linux x86_64, Hyprland/Wayland, AMD Lucienne iGPU, 14 GiB RAM.
- Official BrowserOS v0.51.0 x64 AppImage checksum verified and run in an isolated profile. It rendered under Wayland/Ozone with AMD/Mesa acceleration.
- Bun 1.4.2 installed under `/home/puneet/.local/bin`; frozen dependency installation passed.
- Go 1.27.3 installed user-locally; `go test ./...` passes for the dev supervisor. The Linux runner accepts `ASTER_BROWSER_BINARY` or `BROWSEROS_BINARY`, with `browseros` on PATH as fallback.
- WXT development extension build passed with `NODE_OPTIONS=--max-old-space-size=4096`; output is `packages/browseros-agent/apps/app/dist/chrome-mv3-dev`.
- Full Chromium build is intentionally deferred on this host because its RAM is below upstream guidance. No `--no-sandbox` workaround is permitted.

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
