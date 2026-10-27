# Security baseline

- Preserve Chromium sandbox and native permission/profile boundaries.
- Do not send passwords, cookies, passkeys, session tokens, API keys, or profile databases to an LLM.
- Bind any local CDP/MCP/control interface to loopback and authenticate it.
- Browser page content is untrusted input; authorization must be enforced by tools, not prompt text alone. Deny takes precedence over ask/allow.
- Require explicit approvals for external sends, posts, purchases, destructive changes, and sensitive file writes.
- No credentials, real user tasks, or existing browser profiles in tests.
- Model calls, analytics, sync, and update traffic must be disclosed and user controlled.
- Preserve AGPL-3.0-or-later and third-party license notices.

No Aster security tests have run.
