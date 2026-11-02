Task-ID: ASTER-20261102-001
Base-SHA: 648f9499c1287016780aa88e977b6b0a447d0f05
Safety-mode: implementation

# Aster task 001: provider timeouts and closed-page failures

## Goal
Continue Aster source implementation, not another project-wide planning cycle.
Review the current feature branch and latest evidence (particularly
`docs/evidence/aster-a01-a02-production-integration-2026-11-02.md`).
Build and verify two currently unverified failure paths in the real
UI → ChatService → ToolLoopAgent → Browser MCP pipeline.

## Priority 1: a genuine provider timeout
Inspect actual provider adapter and HTTP/stream timeout behavior. Use a
controllable local OpenAI-compatible provider fixture that stalls, then
verify the appropriate bounded timeout, cancellation and user-visible error.
Preserve exact toolCallId, existing approval grants, task IDs and no-replay
boundaries. Fix a demonstrated production defect, not simply a fake response.
Do not contact or invent a real cloud model.

## Priority 2: page disappears during an actual read
Extend the existing headed A01/A02 BrowserOS smoke, using a disposable
profile and a run-unique loopback fixture. Close the attached tab while
read is pending and verify the tool reports an explicit error, no unrelated
page data is consumed and the visible answer makes no false factual claim.
Use existing smoke helpers; no duplicate framework.

## Work protocol
Use at most three Luna medium subagents if actually available; assign
non-overlapping ownership and cross-review. Do not use Sol/Terra.
If local native Chromium resources are unsafe, leave that checkout untouched.
Run focused Bun tests, typechecks, Biome, Python compile and headed checks
where feasible. Commit reviewed code and evidence with Conventional Commits.
Do not mark A01/A02 PASS from BrowserOS fixtures. Never force push. Work
within the verified local feature branch and do not touch `aster-control`.
Report actual implementation, tests, exact source SHA, native boundaries,
cleanup and the next productive task. The worker separately publishes an
immutable outcome report after Codex exits.
