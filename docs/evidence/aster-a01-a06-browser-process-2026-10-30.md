# A01/A06 compiled-sidecar BrowserOS process fixture — 2026-10-30

**Evidence level:** disposable headless BrowserOS process fixture, not Aster-native.

Command, from `packages/browseros-agent/apps/server`:

```sh
CHROMIUM_BINARY=/home/puneet/Downloads/BrowserOS_v0.51.0_x64.AppImage \
ASTER_SERVER_BINARY=/home/puneet/Projects/aster-browser/upstream-browseros/packages/browseros-agent/dist/prod/aster-server/linux-x64/resources/bin/aster_server \
bun tests/integration/process-approval-fixture.ts --execute --browser
```

Result: **PASS**, `approval-and-browser`; compiled sidecar SHA-256 `34abe0b0907ff01e7c18e3e030cc367c1f8484fe94785510f0bf7c39059518ed`. Headless BrowserOS Chromium v0.51.0 used a fresh per-run profile and connected to the compiled sidecar, loopback model/MCP fixtures, and a local page. The deterministic fixture model selected `tabs.list`, `navigate` to `http://127.0.0.1:<ephemeral-port>/fixture`, `tabs.list`, then `read` with `{page: 1, format: "text"}`. The read result contained the synthetic page title `Aster Local Fixture` and sentinel `ASTER_LOCAL_PAGE_SENTINEL_71C4`; the page server observed exactly one `/fixture` request.

In the same run, the synthetic `send_message` mutation was approved and dispatched once to the dummy sink; denial caused zero additional dispatches and replay was rejected. No live model, external service, user profile, or real credential was used. The original detailed evidence and logs remain under `/tmp/aster-chat-process-X9lgzE/` and are not copied here.

**Limitations:** this is BrowserOS fixture evidence, not linked Aster or native Chromium. The deterministic model does not establish semantic page understanding. Chromium's resolver rule blocks hostname resolution except loopback, but does **not** prevent connections to external IP literals; do not describe browser egress as network-isolated. Approval settings UI, packaged Aster/ACP behavior, real provider behavior, and crash/restart during this browser task remain open.
