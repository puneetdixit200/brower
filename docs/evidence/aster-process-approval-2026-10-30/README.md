# Compiled-sidecar approval transport fixture — 2026-10-30

Run from `packages/browseros-agent/apps/server`:

```sh
bun tests/integration/process-approval-fixture.ts
bun tests/integration/process-approval-fixture.ts --execute
```

The first command only prints a plan. The second launches isolated loopback fixtures, stock sandbox-enabled headless Chromium for sidecar startup, and the compiled Aster sidecar. `ASTER_SERVER_BINARY` and `CHROMIUM_BINARY` select binaries. The source resource build/provenance is recorded in `../aster-server-provenance-2026-10-30.json`.

`final-approval-pass/evidence.json` records the final harness PASS: four local provider requests, one approved MCP dispatch, duplicate approval HTTP409, no additional dispatch on denial. All data/keys are synthetic. Owned child processes exited. This does not establish native browser/UI behavior, external exactly-once effects, process restart, or live-provider acceptance.

`--execute --browser` additionally attempts real production browser tools against a local page. It requires BrowserOS/Aster Chromium exposing `Browser.getTabs`; stock Chromium returns the exact error retained in `browser-diagnostic/evidence.json`. Two failed browser attempts are retained; do not repeat this prerequisite unchanged. The earlier approval-only pass and Bun stream-stdio failure are separate evidence, not final browser acceptance.

Static checks from `packages/browseros-agent` passed:

```sh
bunx biome check --write apps/server/tests/integration/process-approval-fixture.ts
bunx tsc --ignoreConfig --noEmit --allowImportingTsExtensions --module preserve --moduleResolution bundler --target esnext --types bun,node --skipLibCheck apps/server/tests/integration/process-approval-fixture.ts
```

Next: compatible browser tool tab targeting/navigation, stop/killed-sidecar restart, and stale/altered-grant rejection without mutation replay; packaged/native acceptance remains open.
