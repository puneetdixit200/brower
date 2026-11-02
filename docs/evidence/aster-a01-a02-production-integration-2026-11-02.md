# A01/A02 production integration and native build checkpoint — 2026-11-02

## Scope and result

Starting repository commit: `cd77ae46e17ded6f98a9210d9f2181a3fc27f8f2`, branch `feat/aster-linux-ui`; `aster/feat/aster-linux-ui` matched at start. The final headed run used BrowserOS v0.51.0 / Chromium 155.0.8309.26 with the development extension and local sidecar in disposable profile `/tmp/aster-browser-milestone-20261102/aster-browser/dev/browseros-dev-953425027`.

This extends the prior deterministic UI-to-Browser-MCP journey with live navigation-during-read, source-disappearance, Stop, and provider-authentication cases. The local OpenAI-compatible fixture follows the actual request/tool-result continuation and derives its successful answers from returned page text. It is transport and data-grounding evidence, not genuine model reasoning.

## Headed journey

Final passing run marker: `9EE858EEB418`; loopback fixture origin `http://127.0.0.1:46089`; disposable runtime CDP/server/extension ports `9101/9253/9252`. The rerun asserted exactly 18 provider turns and matched each interrupted-read error's page ID to both the submitted `read` call and the selected `tabs` result.

- Page A, tab `346349049`, Authentication / Complete, carried the unique token `ASTER_ORION_AUTH_9EE858EEB418`. The visible UI attached A; Browser MCP made one `tabs` and one `read` call (page ID 2). The actual tool result included the status, token, source URL, and tool-call ID `a01-a_only-read-1`; the displayed answer cited A's URL.
- Page B, tab `346349050`, Database Migration / Pending, carried `ASTER_ORION_DB_9EE858EEB418`. One `tabs` and one `read` call (page ID 3) returned its exact content under tool-call ID `a01-b_only-read-1`; the displayed answer cited B's changed URL `...?changed=1`.
- A+B comparison made one `tabs` and two `read` calls, with distinct page IDs 3 and 2, URLs, and tool-call IDs `a01-compare-read-1` / `a01-compare-read-2`. The visible result attributed Authentication Complete to A and Database Migration Pending to B.
- The unrelated Archive tab `346349051` contained a misleading Authentication Blocked status and unique token. Explicit request context and visible answers did not include it.
- Stop during the delayed pre-read turn followed one `tabs` call and dispatched zero `read` calls.
- During A's pending read, a separate CDP `Page.navigate` changed the page URL. Browser MCP returned exactly `read: page 2 navigated, changed, or closed during read; retry`. The visible assistant response said the source was unavailable and made no status claim.
- During B's pending read, its source navigated to `about:blank`. Browser MCP returned exactly `read: page 3 navigated, changed, or closed during read; retry`. The visible assistant response said the source was unavailable and made no status claim. A separate attempt to close the tab during the read caused BrowserOS to close the sidepanel CDP target; the UI result could not be inspected in that case. The passing disappearing-source case therefore uses navigation to `about:blank`, not tab closure.
- A loopback provider response returned HTTP 401 with `Synthetic provider authentication failure`. The visible sidepanel displayed `Authentication failed` and the provider message; zero Browser MCP calls followed.

The passing run made **6 Browser MCP `tabs` calls, 6 `read` calls, and 18 provider turns**. The deterministic fixture received actual tool results before producing each successful final answer. It is not proof of real-model comprehension.

The displayed successful answer strings were:

```text
Authentication: Complete (source: http://127.0.0.1:46089/a?run=9EE858EEB418; evidence: ASTER_ORION_AUTH_9EE858EEB418)
Database Migration: Pending (source: http://127.0.0.1:46089/b?run=9EE858EEB418&changed=1; evidence: ASTER_ORION_DB_9EE858EEB418)
```

The comparison displayed both lines, with the same per-page source URL and token. In all cases these lines were formatted from the returned Browser MCP tool-result text, not from a preset answer.

## Provider evaluation and errors

No authorized real model was configured or reached. The shell had no model credential/configuration variable names set, and no common local Ollama/LM Studio listener was present. No external provider request was made.

Added loopback coverage runs the production OpenAI-compatible adapter through the AI SDK ToolLoopAgent/stream path. Seven test cases cover 401/403, 429 with a preserved `Retry-After: 7` hint, HTTP 503, refused loopback connection, interrupted stream, and partial assistant output before stream failure. `maxRetries: 0` means the 429 test proves hint propagation, not retry attempts or timing. Timeout configuration is not verified by this suite.

## Browser MCP changes and checks

`read` now rejects content if the selected page disappears, its page ID/target/URL changes, the CDP connection epoch changes, or the main-frame loader changes. Missing loader identity before or after evaluation fails closed; missing/non-string CDP values fail as errors. Cancellation is checked around CDP calls and before/after temporary output-file writes. Browser-MCP read tests and Browser-Core page-manager tests: **14 passed, 0 failed, 35 assertions**.

Commands and results:

- `bun test packages/browser-mcp/src/tools/read.test.ts packages/browser-core/src/core/pages.test.ts` — 14 passed, 35 assertions.
- `bun test apps/server/tests/agent/provider-loopback-resilience.test.ts` — 7 passed, 21 assertions.
- `bun test tests/agent/provider-loopback-resilience.test.ts tests/agent/tool-execution-claim.test.ts tests/agent/stale-approval-execution.test.ts tests/api/services/chat-service.test.ts` in `apps/server` — 45 passed, 210 assertions.
- `bun test modules/chat/chat-session-request.test.ts` in `apps/app` — 19 passed, 70 assertions.
- `bun run typecheck` in `apps/app` — passed.
- `bun run typecheck` in `packages/browser-mcp` — passed.
- `bun run typecheck` in `apps/server` — passed.
- `bunx biome check packages/browser-mcp/src/tools/read.ts packages/browser-mcp/src/tools/read.test.ts apps/server/tests/agent/provider-loopback-resilience.test.ts` — passed after formatting.
- `python3 -m py_compile tools/dev/smokes/aster_a01_a02_page_read_smoke.py` — passed.
- `NODE_OPTIONS=--max-old-space-size=4096 bun run build:agent:dev` — passed; 24.43 MB development extension output. Existing font-reference, upstream annotation, and large-chunk warnings remain.
- `python3 tools/dev/smokes/aster_a01_a02_page_read_smoke.py --cdp-port 9101 --server-port 9253` — passed. The final run report included exact per-case calls, tool-call IDs, selected URLs, provider turns, and cleanup checks.
- `git diff --check` — passed.

Initial headed attempts were not acceptance runs: the runner first hit a permission error in its default cache path; redirecting to `/tmp` fixed startup. The smoke was corrected to observe committed target URLs rather than relying on the immediate `chrome.tabs.update` response. The tab-close-during-read attempt closed the panel and could not establish visible-result behavior, so it is retained as a limitation rather than reported as passing UI evidence.

## Cleanup

The smoke restored the provider default to its prior value (`null`), deleted the temporary provider, removed its three fixture tabs, closed its CDP websockets, and stopped both local HTTP servers. Ctrl+C stopped the task-owned BrowserOS runner and sidecar; the runner reported `All processes stopped`, and its ports were no longer listening. The three task-created disposable profile directories (`.../browseros-dev-2138660915`, `.../browseros-dev-3402414124`, and final `.../browseros-dev-953425027`) were verified under the task-owned `/tmp` root but retained because the environment command guard rejected profile deletion. The surrounding temporary cache root was also retained.

## Native Chromium bounded check

The adjacent checkout remained unchanged: HEAD `16c3e55476d3564bea713314b2fff638749ce3e6`, 319 existing porcelain rows, status fingerprint `007c892fdb6491c69c25d8ec7da2b0a53b28cecb6b69b94c50c9e7f7b38ab6bd` before and after. No GN regeneration, Ninja build, object generation, link, or native browser launch occurred.

The existing generated `extensions.ninja` / toolchain command for untracked `browseros_extension_loader.cc` was run as a single `-fsyntax-only` translation-unit check with 4 GiB address-space, 150-second CPU, and 180-second wall limits. It exited 0 in 2.943 seconds. Independent review verified the command record, exit/limit evidence, and unchanged checkout. The committed [native syntax evidence JSON](aster-native-loader-syntax-2026-11-02.json) has SHA-256 `f5d8d67c4aed1d37b1e8c650abfa4d00707ddd1672fad259af92c9468bdd8b57`. This establishes syntax acceptance of one dirty source file only; no native object, linked executable, or runtime acceptance exists.

## Independent reviews and limits

- Browser MCP implementation was cross-reviewed against the provider test; reviewer confirmed the production adapter/stream path and corrected the 429 test wording because it preserves a hint rather than exercising retries. Final review of the post-evaluation missing-loader regression confirmed it reaches the intended source branch and found no actionable issue.
- Provider test implementation was cross-reviewed against Browser MCP read changes; no blocking issue was reported.
- The headed smoke received an independent review; findings on turn count, error/source identity, and setup-failure cleanup were fixed and re-reviewed.
- Native compile evidence received a second independent read-only review; the reviewer verified the captured exit/limits and exact unchanged native fingerprint, and emphasized the syntax-only boundary.

A01/A02 remain **PARTIAL**. Real-model semantics, provider timeout behavior, visible tab-close-during-read result, private/cross-window restrictions, external egress enforcement, and native/package acceptance remain open. The adjacent Chromium worktree was not modified.
