# Security baseline

- Preserve Chromium sandbox and native permission/profile boundaries.
- Do not send passwords, cookies, passkeys, session tokens, API keys, or profile databases to an LLM.
- Bind any local CDP/MCP/control interface to loopback and authenticate it.
- Browser page content is untrusted input; authorization must be enforced by tools, not prompt text alone. Deny takes precedence over ask/allow.
- Require explicit approvals for external sends, posts, purchases, destructive changes, and sensitive file writes.
- No credentials, real user tasks, or existing browser profiles in tests.
- Model calls, analytics, sync, and update traffic must be disclosed and user controlled.
- Preserve AGPL-3.0-or-later and third-party license notices.

## Verified Aster controls

- The supervised Linux dev server and CDP listeners were observed on loopback only. This is dev-run evidence, not proof about a future packaged browser.
- `/klavis/*` routes require a trusted local extension request. Route tests reject originless activation and accept the trusted extension origin.
- The server no longer starts its Klavis connector proxy during ordinary startup. The home and chat surfaces defer remote integration queries until the user opens Connect Apps; visiting the dedicated Apps settings page also activates it.
- In a network-isolated headed run, startup and the closed home made no Klavis requests during the initial observation window. Opening Connect Apps triggered the integration fetch and connector attempt, both blocked by the isolated namespace. This confirms the opt-in boundary without establishing successful cloud behavior.
- Focused auth tests passed. The complete CDP/MCP route set, packaged production ports, telemetry, updater, and all other outbound requests still need review.
