# Aster ChatGPT ⇄ Codex GitHub coordination

## Branch isolation

- Browser source: `feat/aster-linux-ui`, pushed through remote `aster`.
- Coordination mailbox: `aster-control` in the **same GitHub repository**.
- ChatGPT updates only `coordination/next-task.md` and optional review notes on `aster-control`.
- The laptop worker writes immutable `coordination/claims/<Task-ID>.json` and
  `coordination/reports/<Task-ID>.json` to `aster-control`.
- The laptop Codex agent edits/commits only the feature branch, never the control branch.
- `origin` must remain upstream; never force-push or reset important changes.

## Single-task admission and acknowledgements

1. ChatGPT selects a new immutable Task-ID and records an exact feature
   Base-SHA in `coordination/next-task.md`.
2. Every laptop poll fetches both remote branches, reads the task with
   `git show`, verifies local branch, clean tree and exact SHA match.
3. The worker creates a GitHub claim file once using the Contents API **without
   an overwrite SHA**. This is its at-most-once admission marker.
4. Codex edits and runs focused checks inside `workspace-write`. Its
   `.git` is intentionally read-only. **After Codex exits**, the trusted
   unsandboxed wrapper verifies the source HEAD did not change, checks
   changed paths against strict code/docs ownership and size limits, refuses
   sensitive/unowned paths and symlinks, stages only those edits, runs normal
   commit hooks with a Conventional Commit message, then makes a normal
   non-force push. If checks/hooks fail or no source files changed, report
   `needs-review` or `no-changes`, without claiming a push.
   Raw model/CLI logs stay on the laptop, not GitHub.
5. A failed GitHub report write stays in a restrictive local outbox and
   is retried at the next poll.
6. ChatGPT reviews the result, commits, code diff and evidence before writing
   a **different** Task-ID (one task outstanding at a time).
7. If a claim has no report, **do not blindly reissue the same task**.
   A crash or long-running process makes side-effect completion uncertain.
   Raise an explicit stalled-task warning and request a safe recovery audit.
8. A duplicate or missed timer event is harmless: existing claims/reports
   prevent auto re-execution, and the next poll reads the current task.

## Timing

- Local Codex worker: systemd **user** timer every 30 minutes at :00 and :30,
  with `Persistent=true`; missed triggers catch up when the user session
  becomes available. `flock` avoids overlapping runs.
- ChatGPT automation: **hourly** because ChatGPT scheduled tasks do not support
  every-30-minute recurrence. It is a best-effort reviewer, not a guaranteed
  real-time always-on server. GitHub Actions/remote pushes may also be delayed.
- No hard execution timeout interrupts a non-idempotent build or browser task.
- The reviewer's task depends on GitHub access being authorized in that run.

## Security

Do not store GitHub tokens, Codex auth files, provider API keys, user secrets,
prompt transcripts, raw terminal logs or private profile contents in GitHub.
Use `gh auth login` and `codex login` locally. Worker launches Codex in
`workspace-write`, not danger-full-access. Never edit/re-run claims to try
to recover an uncertain tool side effect. Use user-approved signing custody;
no manufactured CRX, update feed or password vault bridge.

## Faults and recovery

- **Laptop offline:** no claim occurs; next timer tick reads latest queued task.
- **ChatGPT misses a run:** existing instructions remain valid and claimed tasks
  remain unique; no auto replays.
- **Laptop process crashes after claim:** no automatic re-execution; ChatGPT
  should publish a *new* recovery/inspection-only task after checking status.
- **Result upload fails:** local outbox retries; reports use immutable file paths.
- **Remote source advanced or local worktree dirty:** worker emits BLOCKED
  without touching source; ChatGPT must wait for a human-safe reconciliation
  instead of repeatedly issuing recovery tasks.
- **Sandbox cannot commit:** expected. The wrapper alone validates, stages,
  commits and pushes. If a legacy task left uncommitted edits, the user must
  review and commit them manually before new implementation tasks.
- **Inspection-only manual hold:** a blocked inspection task is a terminal
  safety hold, not permission to create another implementation task. The
  reviewer must wait for human-confirmed clean source + a verified SHA.
- **Git push rejected:** local commits stay intact; report says push-rejected.
- **Multiple machines:** at-most-once GitHub claim creation means only one
  should start; a concurrent contender stops without executing.
- **Prompt races:** tasks have an exact base SHA. Old tasks cannot silently
  operate on a newer source revision.
- **Timer service already active:** systemd and `flock` avoid duplicate work.

## Operational links

Source branch: https://github.com/puneetdixit200/brower/tree/feat/aster-linux-ui

Mailbox: https://github.com/puneetdixit200/brower/tree/aster-control/coordination

Do not interpret 2/72 PASS as a percentage of source implementation.
BrowserOS deterministic tests are not native Aster release acceptance.

## Recovery after 2026-11-02 tasks 001 and 002

Task 001 made reviewed but **uncommitted** source edits because `codex exec
--sandbox workspace-write` cannot write Git metadata. The worker reported
`needs-review`. Task 002 was inspection-only and its dirty-worktree
preflight correctly blocked. **Neither task should be retried automatically.**

The user should disable the timer; inspect `git status`, the entire task
diff, untracked files, and local task-001 log; run applicable checks; then
commit/push **only personally reviewed** task-001 files using normal Git,
without forcing or deleting anything. If needed, ask for a focused manual
reconciliation prompt. This is distinct from a new implementation task.

After verifying the new source SHA and a clean checkout, the ChatGPT reviewer
may publish a **new task ID and new Base-SHA**, and the user should install
the updated `worker.py` from the control branch before reenabling the timer.
Do not edit old immutable claim/report files to make an old task executable.
