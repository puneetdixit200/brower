# Architecture baseline

## Intended system

Aster is an original Omarchy browser product based on the human-driven BrowserOS product. Chromium remains responsible for web rendering, TLS, profiles, tabs, downloads, permissions, and extensions. The BrowserOS WXT/React extension provides new-tab and side-panel experiences. Its Bun/TypeScript server owns agent loops, tools, schedules, and service APIs. Local storage and explicit model-provider configuration are required for Aster additions.

```text
Chromium / BrowserOS native shell
  ├─ web platform, tabs, profiles, permissions, downloads
  ├─ WXT + React extension (new tab, side panel, settings)
  └─ Bun + TypeScript server (agent, tools, schedules, API)
       ├─ local-first data store and editable memory (planned)
       └─ explicitly selected local or cloud model provider
```

## Source mapped at pinned revision

- `packages/browseros-agent/apps/app`: WXT + React extension; entrypoints, screens, components, hooks, modules, libraries.
- `packages/browseros-agent/apps/server/src`: agent, API, tools, provider, database, MCP manager, schedules.
- `packages/browseros-agent/tools/dev`: Go dev supervisor. Its launcher and guide currently identify a macOS-only browser launch path.
- `packages/browseros/bos_build`: Python CLI and Chromium patch/build/release infrastructure.

The extension calls server routes using typed Hono RPC per `CONTRIBUTING.BrowserOS.md`. This is a source map, not proof that Aster features work.

## Verified request paths in pinned upstream

- Chat submit: `apps/app/screens/sidepanel/index/Chat.tsx` calls the chat-session context; `apps/app/modules/chat/chat-session.hooks.ts` sends the stream request through `conversation-run-client.ts` to the local server's `/chat/:conversationId/stream` route. The server resolves the selected provider and agent mode before streaming model output and tool events back to the extension.
- Page action: browser automation tools are registered from `packages/browser-mcp/src/tools/registry.ts`; `act.ts` dispatches page actions through the BrowserOS browser SDK/CDP backend. The tool is accessible through the server agent/tool orchestration path. Page content remains untrusted input and must not grant new permissions.
- Locality: Aster now binds the server HTTP API to `127.0.0.1`; the upstream baseline had bound `0.0.0.0`. This change has a passing startup test. CDP and adjacent services remain in the audit queue.

These paths describe inspected source. Headed Linux smokes exercised a local mocked chat stream with attached loopback context, one read-only tab-list tool, and a denied `act.click` approval request. The denial was applied to the matching server-held pending tool call and returned `tool-output-denied`; a forged approval ID returned HTTP 409. This verifies the transport and denial path, not semantic page understanding, successful approved-action execution, real-provider behavior, or the rendered approval buttons.

## Boundaries

Keep Chromium security and user profiles intact. Never pass password values, cookies, passkeys, or tokens to a model. Never disable Chromium sandbox or expose CDP/MCP beyond loopback. Network model use, telemetry, sync, and updates require clear user control.
