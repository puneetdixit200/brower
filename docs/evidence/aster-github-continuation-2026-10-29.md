# Aster GitHub-only continuation, 2026-10-29

## Provenance and scope

- Starting authenticated feature-branch HEAD: `9ee82a38f0410d2ca5cccbbf29fcf08b11890b4b`. The user-supplied abbreviated checkpoint was accurate and there were no additional remote commits ahead at fetch time.
- Branch: `feat/aster-linux-ui` in `puneetdixit200/brower`. Source was changed through SHA-checked GitHub file writes. No force-push, checkout reset, or change to the upstream remote occurred.
- A local `git ls-remote` failed because `github.com` DNS resolution is unavailable in the container. This session therefore cannot attest to a cloned local worktree or the user's host-local dirty files and compiled Chromium outputs.
- No Luna subagent execution capability was available in the exposed tools, so all bounded implementation and review was performed directly. No Sol or Terra delegation was used.
- The main goal remains incomplete. The canonical matrix stays at **2 PASS, 68 PARTIAL, 1 PARTIAL/BLOCKED, 1 NOT_STARTED** out of 72. The original master specification and 103 implementation subtasks remain binding.

## T30: owner-aware scheduled recovery (R02, R03)

New pure helper: `packages/browseros-agent/apps/app/lib/schedules/stale-run-policy.ts`.

The extension previously identified stale `running` records solely by age. On startup, idle-active reconciliation, or other cleanup, a run legitimately executing for more than 10 minutes could be marked `failed` even while that extension worker retained its active abort controller. The new predicate requires:

- exact running status and valid finite timing inputs;
- record age strictly greater than the configured stale threshold;
- no matching active run ID in the local worker's abort-controller map;
- no matching active job ID in the local worker's active-job set.

`apps/app/entrypoints/background/scheduledJobRuns.ts` now applies that predicate before writing a terminal record. Source-only check: the existing SQLite partial unique running-job index remains the cross-process admission mechanism; this patch does **not** prove cross-worker/server liveness, prevent every replay, or make a ten-minute timeout universally safe.

Focused GitHub Actions [run 40786302159](https://github.com/puneetdixit200/brower/actions/runs/40786302159) PASSED on pinned Bun/Linux:
- Aster app TypeScript check;
- 14 tests across `stale-run-policy.test.ts`, `heartbeat-continuation.test.ts`, and `scheduled-alarm-handler.test.ts`, 44 assertions;
- pinned Biome check and whitespace check.

## T26: avoid ambiguous research quote provenance (A11)

Updated `research-source-ledger.ts`, `ChatMessages.tsx`, and focused ledger tests.

The existing source ledger could assign a verbatim answer quote to the closest URL when several different HTTPS citations appeared in the same paragraph. Such a proximity guess could yield a misleading `found` indicator. The new code:

- canonicalizes nearby citations (preserves query and case, ignores fragments);
- rejects quote-to-URL attribution when multiple distinct normalized URLs are plausible in the same paragraph;
- caps quote candidate parsing to 24 attempted quotes, with at most 12 successful matching checks;
- exposes an accessible user-visible count of ambiguous unattributed quotations rather than labeling them as verified;
- preserves attribution when multiple references are merely fragments of the same normalized URL.

Focused GitHub Actions [run 40786688768](https://github.com/puneetdixit200/brower/actions/runs/40786688768) PASSED on pinned Bun/Linux:
- Aster app TypeScript check;
- 22 tests across `research-request.test.ts` and `research-source-ledger.test.ts`, 54 assertions;
- pinned Biome check, no resulting formatter diffs and whitespace check.

This is a deterministic provenance check, not semantic claim support, live-provider source authentication, or factual truth verification. The Browser MCP `UIMessage` tool format still omits the originating MCP server identity, and the source ledger still relies on the production reserved-name collision filter.

## Execution, process and budget status

- No locally owned Chromium, Ninja, browser GUI, test process or subagent was started.
- The two GitHub Actions verification runs above completed successfully. Earlier format-only failures were fixed and do not change the final checked-result claims.
- Account usage/remaining allowance is not visible to this tool set, so a numeric percentage or 5%-remaining threshold cannot be asserted.
- No native Aster executable, GUI, OS suspend/resume, real-provider run or packaged browser integration was tested here.

## Required next work

1. T30.2: Make stale cleanup robust across service-worker restart and a server run still actively executing; use a server-authoritative run-status/lease check or safe reconciliation state, without overlapping jobs or silent replay. Exercise interruption and forced restart in a disposable fixture.
2. T26.3: Implement actual, trust-bounded claim-to-source support and user-visible uncertainty; do not mistake URL visits or literal quote matches for truth. Test against a live configured provider and real returned page evidence.
3. Continue T20a native Chromium linking/launch/extension READY/sandbox against pinned source on an eligible Linux host, then run complete packaged smoke tests, release identity and ownership checks.
4. Keep the full 103-subtask plan active and all 72 feature rows evidence-based. P03 stays NOT_STARTED and S05 PARTIAL/BLOCKED pending real native credential trust boundaries and release signing/update ownership.


## T30.2 source follow-up: cross-worker heartbeat liveness before stale cleanup

After the first owner-aware cleanup passed, added `server-conversation-liveness.ts` and five focused tests. A service worker may lose its in-memory AbortController when it restarts while the server still has an active model run. The background cleanup now performs a short, bounded read-only request to the configured `http://127.0.0.1:<port>/chat/:conversationId/state` route before failing an old heartbeat record.

- Only a correctly formed UUID, strict loopback HTTP destination and explicit trusted chat/state response are considered.
- `running` protects the old heartbeat claim; `completed`, `failed`, `aborted`, `interrupted`, or the endpoint's exact conversation-not-found 404 permits age-based cleanup.
- Unreachable server, timeout, malformed response, changed API, mismatched conversation, other errors or missing port retain the claim rather than assert abandonment.
- The cleanup visits at most ten stale candidates per pass; it does not attempt to rewrite tool/approval state or replay an interrupted mutation.
- This is a *server conversation liveness* check, not full cross-process/external-tool liveness or an atomic guarantee between state read and durable status write. The existing partial unique index remains the cross-worker job-start authority.

Final focused GitHub Actions [run 40787505020](https://github.com/puneetdixit200/brower/actions/runs/40787505020) **PASSED**: app TypeScript, 19 scheduler regression tests (including five new server-liveness cases), pinned Biome and whitespace check. Early intermediate runs had TypeScript/formatting errors and were corrected; only the final run is claimed green.

R02/R03 remain PARTIAL. The highest-priority remaining acceptance work is a real forced service-worker restart while a long sidecar task runs, cancellation/timeout and cross-process overlap fixtures, a crash/restart policy for more than ten stale records, and packaged native Aster acceptance.
