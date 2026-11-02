# A01/A02 selected-page page-read integration — 2026-11-02

## Scope and result

Starting commit: `52ab56f9fa9b69e7000b7be12410a2a1a8cf8bf8` on `feat/aster-linux-ui`.

The headed BrowserOS v0.51.0 / Chromium 155.0.8309.26 development-extension run passed against a disposable profile at `/tmp/aster-a01-a02-page-read-20261102/aster-browser/dev/browseros-dev-upstream-browseros-f2a70ff5`. The visible side-panel picker and composer submitted Page A, Page B, a two-page comparison, and a stopped request. The script prepared loopback tabs and opened the side panel with extension APIs; prompt submission, page attachment, and Stop used the visible UI.

This establishes deterministic transport and page-result grounding. Its local OpenAI-compatible fixture requested `tabs`, inspected that result, requested `read` only for explicitly selected URLs, and formatted the final response from text returned by those reads. It is not evidence of real-model comprehension. The environment had no authorized configured real model; no external provider was called. The run does not claim public-network egress enforcement.

## Headed observations

Run marker: `07C69DCD71C4`; all three fixture pages had distinct run-specific evidence tokens and similar titles. The unrelated Archive page contained a misleading Authentication status of Blocked.

- **Page A:** submitted tab `24958575`, selected URL `http://127.0.0.1:37823/a?run=07C69DCD71C4`; one `tabs` call and one `read` call (Browser MCP page ID 2). The actual read result contained `Component: Authentication`, `Status: Complete`, and `ASTER_ORION_AUTH_07C69DCD71C4`. The visible final response stated Authentication was Complete and cited this URL.
- **Page B:** submitted tab `24958576`, selected URL `http://127.0.0.1:37823/b?run=07C69DCD71C4&changed=1`; one `tabs` call and one `read` call (page ID 3). The actual read result contained `Component: Database Migration`, `Status: Pending`, and `ASTER_ORION_DB_07C69DCD71C4`. The visible response stated Pending and cited this URL.
- **Comparison:** both Page B and Page A were explicitly attached. One `tabs` call was followed by two reads, page IDs 3 and 2. The provider received both exact read results with their distinct tool-call IDs. The visible response attributed Pending to Database Migration at Page B's URL and Complete to Authentication at Page A's URL.
- **Stale attachment:** after attaching Page B, the smoke changed its URL before submission. The request was rejected in the UI and the `/chat` request count did not increase. The live page was then reattached at its changed URL for the positive Page B read.
- **Unrelated page:** Page C remained the panel owner. Requests for explicit attachments had no owner `activeTab` or top-level `windowId`; they contained only the selected tab IDs, window IDs, URLs, and titles. The unrelated URL, title, status, and token were absent from the request and final answers.
- **Stop:** during the deterministic provider's delayed pre-read turn, the smoke clicked the visible Stop button. One `tabs` call had already occurred; zero `read` calls were dispatched, and no final-answer claim was accepted.

Across all cases, the run observed **4 `tabs` calls, 4 `read` calls, and 11 provider turns** (three requests for each successful answer plus the stopped request's two turns). The smoke's JSON output includes the exact returned read text and corresponding tool-call ID for each source.

## Cleanup

The fixture's prior default provider was `null`. Cleanup deleted the temporary provider, verified the default remained `null`, removed all three fixture tabs, stopped both loopback HTTP servers, and closed both CDP connections. The BrowserOS runner and sidecar were then stopped; the runner reported `All processes stopped`. The unique disposable profile directory remains on disk for inspection and was not removed.

## Changes and focused checks

- Browser MCP `read` now refreshes page identity after evaluation, rejects target or URL changes and, when available, rejects a changed main-frame loader ID; successful structured results include the captured target ID. This prevents results from being attributed to a page that changed during the read.
- The server ToolLoopAgent regression now deep-compares the next provider prompt's tool-result message, including the original `toolCallId`, tool name, text result, and structured content.
- App request tests cover multiple explicitly attached tabs and exclusion of the side-panel owner's context.
- `python3 tools/dev/smokes/aster_a01_a02_page_read_smoke.py --cdp-port 9005 --server-port 9105` — passed.
- `NODE_OPTIONS=--max-old-space-size=4096 bun run build:dev` in `apps/app` — passed; 24.43 MB output. Existing unresolved Geist-path, upstream PURE-comment, and large-chunk warnings remain.
- `bun test ./modules/chat/chat-session-request.test.ts` in `apps/app` — 19 passed, 70 assertions.
- `bun test tests/agent/tool-execution-claim.test.ts` in `apps/server` — 8 passed, 25 assertions.
- `bun test src/tools/read.test.ts src/tools/structured-contract.test.ts` in `packages/browser-mcp` — 7 passed, 44 assertions.
- App, server, and Browser MCP `bun run typecheck` — passed.
- Targeted `bunx biome check` on the five changed TypeScript files — passed.
- `python3 -m py_compile tools/dev/smokes/aster_a01_a02_page_read_smoke.py` — passed.
- `git diff --check` — passed.

During harness development, early headed attempts exposed and fixed attachment-reset assumptions, an incomplete compare/cancel reattachment, a malformed wait predicate, and cleanup ordering. A post-shutdown rerun correctly failed at CDP connection with `Connection refused`; the runtime was restarted and the final complete run above passed. No production feature claim relies on those failed harness attempts.

## Independent review and remaining gaps

The three Luna reviewers cross-reviewed the other implementation areas. Review findings about the smoke's app-socket cleanup, repeated picker toggling, and unrelated-page leakage were fixed and re-reviewed. The server test was strengthened after review to bind the exact tool result to the call ID. The Browser MCP review found no actionable wrong-target issue and noted that same-URL reload detection depends on `Page.getFrameTree` returning a loader ID; URL and target checks remain active when it does not.

A01 and A02 remain **PARTIAL**. Real-model reasoning, provider timeout/auth/rate-limit/unavailable cases, navigation during an actual headed read, cross-window and private-window cases, public egress enforcement, and native Aster/package acceptance remain unverified. This BrowserOS result is not native Aster acceptance. The adjacent Chromium checkout was not modified or built.
