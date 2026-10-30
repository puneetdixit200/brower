# T23.2 partial transcript process recovery — 2026-10-30

Built the Linux x64 development sidecar from the current source with `bun scripts/build/aster-server.ts --target=linux-x64 --no-upload`, then ran `bun tests/integration/process-approval-fixture.ts --execute --partial-restart` from `packages/browseros-agent/apps/server`.

The fixture used a fresh state directory and loopback-only synthetic provider/MCP endpoints. It streamed 360 bytes of synthetic assistant text without finishing the provider stream, waited until the SQLite checkpoint matched, SIGKILLed the sidecar, restarted it against the same state, and queried the exact conversation state. The snapshot was `interrupted`, returned the exact bounded text, contained no replayable messages, and caused no second provider request or MCP dispatch. Binary hash and compact assertions are in [the sanitized evidence record](aster-partial-transcript-restart-2026-10-30.json).

This verifies a compiled-sidecar process restart path only. It does not test a Chromium process crash, headed Task History display, native Aster Chromium, or a packaged release. A05/T23.2 remains PARTIAL.
