# Linux development runner

This runner uses the pinned BrowserOS-compatible Linux browser binary with the built WXT extension and local Bun agent server. It does not build Chromium from source.

## Start

```bash
cd ~/Projects/aster-browser/upstream-browseros/packages/browseros-agent
ASTER_BROWSER_BIN="$HOME/Downloads/BrowserOS_v0.51.0_x64.AppImage" \
  ./tools/dev/linux/run.sh
```

Set `ASTER_BROWSER_BIN` to an executable BrowserOS-compatible binary or AppImage. `ASTER_BROWSER_BINARY` and `BROWSEROS_BINARY` are accepted aliases; a `browseros` command on `PATH` is the fallback. The script uses Bun 1.4.2 from the repository and Go from `PATH`, `~/.local/bin`, or `~/.local/opt/go/bin`.

The supervisor reserves available loopback ports instead of terminating processes on preferred ports. The HTTP agent service binds to `127.0.0.1`; CDP is used only on loopback. Chromium sandboxing remains enabled. On Linux, the runner waits for the unpacked extension's service worker to register, then opens its home page through CDP; this avoids a Chromium startup race that otherwise leaves an `ERR_BLOCKED_BY_CLIENT` page. The first launch creates an isolated worktree-specific profile under `${XDG_CACHE_HOME:-~/.cache}/aster-browser/dev/` with mode 700; the agent database, logs, and generated files live in that profile's `agent-state/` directory.

## Stop and inspect

Press `Ctrl+C` once to stop the browser and server cleanly. The terminal displays build and runtime logs; the runner does not write a separate log file that could capture page content. Pressing `Ctrl+C` again forces child termination if graceful shutdown stalls.

After startup, the supervisor prints the selected ports, profile path, and health endpoint. Verify the service with `curl http://127.0.0.1:<server-port>/system/health`; it should report `status: ok` and `cdpConnected: true`. The unpacked extension home is opened after its service worker registers because this BrowserOS build reserves `chrome://newtab` for its native profile.

If startup fails, preserve the terminal output, stop with `Ctrl+C`, and inspect the profile path printed by the runner. Do not remove the regular browser profile or use broad `pkill` commands. The upstream `browseros-dev reset --help` command documents its interactive development-profile recovery options.

## Verification limits

Verified on Omarchy/Hyprland with BrowserOS v0.51.0 AppImage in a network-isolated namespace: WXT build, BrowserOS window, extension home, CDP connection, local HTTP health check, extension-page fetch to the health route, and clean shutdown. Third-party Klavis access is unavailable in that namespace; cloud provider requests and live reload remain unverified.
