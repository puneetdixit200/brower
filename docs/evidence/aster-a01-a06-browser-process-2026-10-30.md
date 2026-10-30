# A01/A06 compiled-sidecar BrowserOS process fixture — 2026-10-30

**Evidence level:** disposable headless BrowserOS process fixture, not Aster-native.

Command, from `packages/browseros-agent/apps/server`:

```sh
CHROMIUM_BINARY=/home/puneet/Downloads/BrowserOS_v0.51.0_x64.AppImage \
ASTER_SERVER_BINARY=/home/puneet/Projects/aster-browser/upstream-browseros/packages/browseros-agent/dist/prod/aster-server/linux-x64/resources/bin/aster_server \
python3 tests/integration/run_browser_process_fixture_isolated.py
```

The command above is the current safe invocation. It runs Bun and the full
`--execute --browser` fixture inside a fresh unprivileged user/network
namespace, brings up only loopback, verifies no other interface/default route,
and checks loopback success plus public IPv4/IPv6 literal connection failure.
The fixture requires an inherited open host-network namespace descriptor and
rejects direct calls to its internal wrapper entrypoint before changing
loopback state.
On 2026-10-30 the namespace preflight passed: only `lo` was visible, there was
no IPv4/IPv6 default route, loopback TCP worked, and public IPv4/IPv6 literal
connects were unreachable. The BrowserOS process then exited before CDP became
available with Chromium's `No usable sandbox` fatal error while running as a
non-root mapped user. The cause is not resolved. The wrapper does not disable
Chromium sandboxing.
The older PASS below predates this namespace wrapper and is not evidence that
the browser journey passed under the new egress boundary.
The wrapper's Python regressions pass 4/4, and server typecheck passes.

Historical result: **PASS**, `approval-and-browser`; compiled sidecar SHA-256 `34abe0b0907ff01e7c18e3e030cc367c1f8484fe94785510f0bf7c39059518ed`. Headless BrowserOS Chromium v0.51.0 used a fresh per-run profile and connected to the compiled sidecar, loopback model/MCP fixtures, and a local page. The deterministic fixture model selected `tabs.list`, `navigate` to `http://127.0.0.1:<ephemeral-port>/fixture`, `tabs.list`, then `read` with `{page: 1, format: "text"}`. The read result contained the synthetic page title `Aster Local Fixture` and sentinel `ASTER_LOCAL_PAGE_SENTINEL_71C4`; the page server observed exactly one `/fixture` request. A follow-up run also asserts that the final streamed assistant text contains both values; captured reply: `Read Aster Local Fixture; sentinel ASTER_LOCAL_PAGE_SENTINEL_71C4.` The fixture model emits that text only after verifying both values in the `read` tool output.

In each run, the synthetic `send_message` mutation was approved and dispatched once to the dummy sink; denial caused zero additional dispatches and replay was rejected. No live model, external service, user profile, or real credential was used. Detailed run evidence and logs remain under `/tmp/aster-chat-process-X9lgzE/`, `/tmp/aster-chat-process-eZ1Yze/`, and `/tmp/aster-chat-process-h8SrOm/`; they are not copied here.

**Limitations:** the recorded BrowserOS journey used only Chromium host-resolver rules and did not block external IP literals. The current namespace preflight is verified, but the BrowserOS journey did not reach CDP inside it because Chromium reported `No usable sandbox`. Do not describe the historical journey as network-isolated. This remains disposable BrowserOS fixture evidence, not linked Aster or native Chromium; the deterministic model does not establish semantic page understanding. Approval settings UI, packaged Aster/ACP behavior, real provider behavior, and crash/restart during this browser task remain open.
