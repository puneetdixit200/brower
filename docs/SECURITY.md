# Security baseline

- Preserve Chromium sandbox and native permission/profile boundaries.
- Do not send passwords, cookies, passkeys, session tokens, API keys, or profile databases to an LLM.
- Bind any local CDP/MCP/control interface to loopback and authenticate it.
- Browser page content is untrusted input; authorization must be enforced by tools, not prompt text alone. Deny takes precedence over ask/allow.
- Require explicit approvals for external sends, posts, purchases, destructive changes, and sensitive file writes.
- No credentials, real user tasks, or existing browser profiles in tests.
- Model calls, analytics, sync, and update traffic must be disclosed and user controlled.
- The built Aster-named extension currently retains BrowserOS's manifest key, update URL, and reporter extension ID. This identity/update mismatch is a release blocker; do not distribute the current manifest as Aster.
- Preserve AGPL-3.0-or-later and third-party license notices.

## Verified Aster controls

- The supervised Linux dev server and CDP listeners were observed on loopback only. This is dev-run evidence, not proof about a future packaged browser.
- `/klavis/*` routes require a trusted local extension request. Route tests reject originless activation and accept the trusted extension origin.
- `/mcp-manager/*` connector install/uninstall routes require a trusted extension request. `/oauth/*` requires an explicit trusted app origin for every method, including the state-starting GET route. Guards are registered before the Hono route mounts; tests cover blocked originless mutations and successful extension-origin requests.
- `/chat/*` now requires an explicit trusted extension origin for every method. This covers chat submission, conversation state/stream reads, panel assignment, stop, and session deletion; originless local callers cannot submit browser work or inspect/stop a run. Chat route tests verify trusted UI traffic continues to work.
- Internal agent MCP calls require a server-issued conversation lease, but the external `/mcp` endpoint still admits unleased local MCP clients and gives them the full tool surface. It rejects browser fetches and the dev server binds loopback, but it has no bearer token yet; this remains an authentication gap and a distribution blocker for exposed MCP.
- The server no longer starts its Klavis connector proxy during ordinary startup. The home and chat surfaces defer remote integration queries until the user opens Connect Apps; visiting the dedicated Apps settings page also activates it.
- In a network-isolated headed run, startup and the closed home made no Klavis requests during the initial observation window. Opening Connect Apps triggered the integration fetch and connector attempt, both blocked by the isolated namespace. This confirms the opt-in boundary without establishing successful cloud behavior.
- Focused auth tests passed. The complete CDP/MCP route set, packaged production ports, telemetry, updater, and all other outbound requests still need review. `/system/shutdown` retains its originless localhost compatibility route for shipped BrowserOS restarts; external web origins are rejected, but another local process can request a server shutdown.
- The agent checks proposed tool names and descriptions before execution. It requests approval for browser `act`, code execution, file transfers and mutations, browser organization/window changes, external connector names/descriptions that indicate side effects, and any tool outside the explicit read-only allowlist. A headed isolated denial run confirmed `act.click` did not execute after Deny. Tool semantics are not statically verified; a tool with misleading metadata could still be misclassified. Guard/Full modes and user-editable allow/ask/deny rules are not implemented.
- Approval responses require a trusted extension origin and must match an unresolved request in server-held conversation history. Unknown, stale, or duplicate IDs fail closed. HMAC approval signatures use a process-scoped secret, so unresolved approvals cannot be resumed after server restart. In a headed isolated run, the pending card remained expanded and its Deny button resumed the turn; the Approve path remains untested.


## External MCP access

- External `/mcp` POST requests require `Authorization: Bearer <token>` unless the request carries a valid server-issued internal lease. The token is random, persistent across restarts, stored under the BrowserOS state directory with owner-only permissions, and compared in constant time.
- `/mcp-manager/access` returns the token only to a JSON POST with an explicit trusted extension origin. A headed, network-isolated BrowserOS run verified that the settings page receives the token and that the configured external-facing `/mcp` endpoint denies requests without the bearer header and accepts it when present. One-click integrations install the header, and startup reconciliation restores it while preserving the existing URL when needed.
- A real third-party MCP client and packaged production proxy/build are still release checks. Packaged builds must ensure that the state directory is private and that the proxy forwards Authorization unchanged.
