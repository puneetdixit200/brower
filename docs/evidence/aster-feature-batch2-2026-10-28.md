# Aster feature implementation batch 2 — 2026-10-28

## Repository and scope

The authenticated GitHub feature branch was checked at `c01c4dbdeea9afc722315a852f1d242356d68e7e` before new changes. All source updates in this batch were committed directly to `feat/aster-linux-ui` using SHA-checked GitHub file updates. No force-push, upstream `origin` mutation, release signing or update-feed provisioning occurred.

A local clone still failed DNS resolution for `github.com`, so the actual native pinned Chromium tree, connected Omarchy display and previously observed host-local artifacts remain inaccessible. GitHub Actions on Linux was used for extension/server TypeScript, focused Bun tests and pinned Biome formatting. This is **not** a native Aster binary, Omarchy integration or GUI acceptance run.

## Implemented source changes

### U02: browser sidebar controls

- `SidebarBrowserGroups.tsx` now uses Chromium `bookmarks.getTree` rather than only a recent-items list. Folder paths remain searchable; a bounded traversal and HTTP(S)-only URL guard protect the rail.
- Actual current-window tabs offer pin/unpin and close actions. Before modifying a tab, the UI re-queries `chrome.tabs.query({currentWindow:true})` and refuses missing or Aster-extension-owned tab IDs. The existing tab activation re-check remains in place.
- Normal bookmarks are not queried when the current window is private. Existing conversation history continues to display separately.
- These are extension controls on top of Chromium, not evidence of native split panes, tab drag/reopen or an updated Chromium tab strip.

### A06 and U17: server authorization and human review

- `tool-approval-policy.ts` requires approval for all non-observation `tabs` actions (including new, move, pin, close and unknown actions). `history` actions other than list/search/query now require approval.
- `ToolBatch.tsx` uses a bounded and recursive secret-aware review formatter that omits credential-shaped values, secret-named fields, oversized content and URL query/fragment tokens. The source tool-call input used for authorized execution is **not modified** by this display formatter.
- The existing Approve/Deny controls still apply to server-tracked approval identifiers. This remains an inline UI, not a complete per-site permission manager or durable signed-release consent system.
- New focused tests cover URL redaction, bearer tokens, circular/oversized input and mutating tab/history actions.

### U16: user-initiated local task report export

- `export-task-report.ts` generates bounded Markdown summaries from actual `ExecutionTaskRecord` fields after the existing safe-display filter.
- The explicit download button on `TaskHistoryPage.tsx` saves the report locally. The exporter excludes raw tool input/output, stored approval reasons and arbitrary hidden transcript parts.
- This does not invent file artifacts or replay task execution. Full task transcript and real agent artifact downloads remain open.

## GitHub Actions verification

Runner: `Aster focused development checks` (Ubuntu, Bun pinned in monorepo). Before the final formatter checkpoint, the targeted app and server TypeScript checks and focused Bun tests passed. The formatter initially proposed deterministic changes, which were retrieved from the same CI job and applied to source rather than bypassing lint.

- Browser sidebar tests cover safe bookmark URL schemes, bounded folder traversal and invalid/extension-owned tab filtering.
- Approval tests cover server mutation decisions and redacted human approval details.
- Task report tests cover safe saved summary and omission of raw tool input/output plus denial of credential-shaped records.
- **A passing CI workflow proves only this source subset.** It does not prove no crashes, native Chromium APIs, Wayland, permissions, extension READY, sandbox, Linux packaging, release signing or the full 72-feature matrix.

## Feature accounting

Canonical 72-row matrix after the batch: **2 PASS, 32 PARTIAL (including one PARTIAL/BLOCKED), 38 NOT_STARTED**. U17 moved from NOT_STARTED to PARTIAL based on real source and focused check evidence; U02, U16, A06 remain PARTIAL. No native browser rows or performance metrics are promoted on the basis of these commits.

## Highest-value remaining implementation

1. Complete linked native Aster Chromium compilation against pinned sources, then verify a real browser launch and extension READY with two Ninja jobs before native acceptance.
2. Finish split browsing and browser tab organization; eliminate read-only/Guard/Full access ambiguity in agent server guards and configuration.
3. Complete non-replaying durable task recovery, approval/credential isolation and per-tab incognito boundaries, plus real artifact generation.
4. Implement true provider/model/reasoning controls with verified actual routing; complete source-aware research and scheduled heartbeat semantics.
5. Do native Linux packaging, update/signing custody, privacy/outbound review, and matched startup/CPU/RAM/browser benchmarks.

The complete master spec and all 95 tasks remain binding. Do not mark this project complete or ship a release from this source-only checkpoint.


## Final verified focused CI result

[GitHub Actions run 40682050699](https://github.com/puneetdixit200/brower/actions/runs/40682050699) completed with `success` after applying reviewed pinned Biome-generated formatting. Both extension and server TypeScript checks, 12 focused Bun tests across sidebar, approval UI, policy, and task reports, and focused Biome check passed. The runner checked out the actual feature branch revision containing the implementation; subsequent documentation-only commits do not alter those source files. This does **not** represent full workspace or native Chromium validation.
