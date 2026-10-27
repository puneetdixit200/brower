# Aster development server resources

This is a Linux x64 development resource bundle, not a packaged Aster browser release. Its executable, archive, product component and state paths are Aster-owned; BrowserOS product resources and OTA feeds are not selected as fallbacks.

From `packages/browseros-agent`, build with the repository-pinned Bun version:

```sh
bun scripts/build/aster-server.ts --target=linux-x64 --no-upload
```

The local-only wrapper rejects upload/versioned-only requests, unsupported targets and duplicate target flags. It writes ignored output under `dist/prod/aster-server/`, including `aster-server-resources-linux-x64.zip`. The bundle contains `resources/bin/aster_server`, Bun under `resources/bin/third_party/bun`, version/platform/architecture/checksum provenance, database migrations and artifact metadata. The builder verifies the invoking Bun against the exact package version pin and Linux x64 ELF before staging it. This records local artifact consistency, not upstream vendor authentication.

The Aster build inlines its product marker and leaves optional telemetry keys empty. BrowserOS builds explicitly inline the non-Aster marker, so an ambient build variable cannot silently change their state identity. Baked Aster uses `ASTER_DIR` when set, otherwise `~/.aster` (`~/.aster-dev` in development); it ignores the legacy `BROWSEROS_DIR` override. The server and browser MCP share state resolution so output writes and server readback use the same directory.

For tests, always set `ASTER_DIR` to a disposable directory and use a disposable browser/CDP profile. Pass a sidecar config whose resources directory points to the extracted `resources` directory and whose execution directory and ports belong to that test. Source/BrowserOS server tests instead require an explicit disposable `BROWSEROS_DIR`. Preserve the browser sandbox and bind services to loopback.

Filesystem Bash receives the configured resource directory and exposes the real validated Bun executable inside Bubblewrap. It never treats the compiled server executable as a JavaScript runtime. Missing or unsafe packaged runtimes fail closed.

## Verified and remaining

The extracted Bun runs JavaScript; its hash agrees with the provenance and artifact metadata. Independent isolated server startup against headless Chromium returned health OK with CDP connected, kept telemetry off and wrote state only under `ASTER_DIR`, leaving a poisoned `BROWSEROS_DIR` absent. See `evidence/aster-server-development-2026-10-28.json`.

The definition-only Aster product doctor now passes. Full native source staging still needs the Aster extension/CRX and onboarding producers; native managed-sidecar integration, the actual Chromium build, packaged tool-output tests and release provisioning remain incomplete. The development archive is ignored by Git and is not uploaded by this command.
