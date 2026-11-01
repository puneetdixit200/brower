# A01/A02 selected-page context integration — 2026-11-02

**Evidence level:** headed BrowserOS v0.51.0 / Chromium 155.0.8309.26 development runtime with the real local sidecar, using a task-owned disposable profile. This is not native Aster acceptance.

## Observed journey

The smoke `packages/browseros-agent/tools/dev/smokes/aster_chat_page_identity_smoke.py` opened two loopback fixture pages, A and B, and used the actual side panel. From Page A's panel, the visible tab picker attached Page B and the visible composer submitted a prompt. The captured `/chat` body contained B's tab ID, window ID, and URL, with no Page A owner metadata, URL, or title. After B navigated, a second send displayed the stale-address error and did not create another `/chat` request. Removing B from the same panel and submitting again produced an A-only context body with no B URL or title. The client also revalidates owner-only context after asynchronous server URL resolution and rejects an owner tab that has closed, moved, or changed address.

The loopback dummy OpenAI-compatible endpoint received exactly two requests and returned a generic acknowledgement that explicitly did not read page content. The UI rendered both replies. The smoke reported success only after its cleanup completed: both fixture tabs were removed, the temporary provider was deleted, the prior provider default (including `null`) was restored and verified, the WebSocket and fixture server resources were closed, and the worker stopped. A cleanup failure raises before any success JSON is printed.

The headed run used CDP port 9005 and sidecar port 9105. Fixture IDs in the final passing run were `174940320` and `174940321`. The selected-page context test does not use hard-coded page content to manufacture an answer. An interim rerun initially failed because the smoke expected an older error string; the observed UI used the updated shared guard message. The selector was corrected, and the rebuilt-extension rerun passed.

## Source and focused verification

- App context tests: 24 passed, 0 failed, 79 assertions.
- Server execution-claim tests: 7 passed, 0 failed, 21 assertions. They verify provider tool-call ID validation/preservation; they do not establish a real provider tool continuation.
- Browser-core navigation and observer tests: 17 passed, 0 failed, 50 assertions. These cover shared operation deadlines and stale page refs.
- App, server, and browser-core TypeScript checks passed.
- Targeted Biome, Python compilation of the smoke, and `git diff --check` passed.
- Development extension build passed earlier in this batch with a 4 GiB Node heap override; no native Chromium build was run.
- Independent Luna review confirmed the smoke cleanup and success-output ordering. Earlier independent reviews found no actionable server identity or UI selected-context issue; navigation timeout findings were fixed and re-reviewed.

## Limits and remaining work

This run proves selected-page identity reaches `/chat` through the headed BrowserOS side panel and that a changed attached URL fails closed. The local provider made no Browser MCP tool call; no real model was configured or evaluated. The run therefore proves neither semantic page comprehension nor the A01 `tabs → read → attributed answer` flow anew. The separate 2026-10-30 deterministic A01 evidence remains fixture evidence only. This run also did not synthesize information from two pages, test Stop, or cover moved/closed pages in the headed runtime. A02's existing deterministic route/form fixture remains separate evidence; no multi-page real-provider journey was run.

There was no network namespace isolation in this run, no external model request, and no native Aster executable/build. Keep A01 and A02 PARTIAL. Next: run a genuinely configured, explicitly authorized local or external model through the selected-context flow and verify page-specific answer grounding; exercise Browser MCP reads across two pages with accurate source attribution and failure on a disappearing source; then repeat the required acceptance against linked native Aster and packaged runtime.
