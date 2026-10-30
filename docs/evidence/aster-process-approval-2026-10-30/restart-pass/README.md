# Compiled sidecar stale-approval restart fixture

Command: `ASTER_SERVER_BINARY=<built-linux-x64-sidecar> bun tests/integration/process-approval-fixture.ts --execute --restart` (bounded with `timeout 180s`). The synthetic provider and MCP sink bind to loopback, with a fresh `ASTER_DIR`, SQLite database, and execution directory.

The real compiled sidecar persisted one pending `send_message` approval, was killed with `SIGKILL`, and restarted against the same state. The first stale approval and its replay each returned HTTP 409. Read-only SQLite inspection confirmed the persisted tool part changed to `approval-responded` with `approved: false` and the restart-expiry reason. No post-restart model request or MCP dispatch occurred. The retained artifacts remove the approval signature, host-specific paths, host name, process IDs, conversation ID and ephemeral port values. The local test data uses only a synthetic destination/body.

Binary SHA-256: `b8f86ec981680944885b13024fd578a8ff792876ab5e8c0d52dd1a294652e4e9`.

This is compiled-sidecar/process evidence, not a headed BrowserOS or Aster-native browser run, live provider test, or proof that task streams/tool effects resume after a crash. A05 and A06 remain PARTIAL.
