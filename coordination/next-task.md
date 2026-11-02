Task-ID: ASTER-20261102-002
Base-SHA: 648f9499c1287016780aa88e977b6b0a447d0f05
Safety-mode: inspection-only-manual-hold

# Aster task 002: preserve and reconcile local changes from task 001

## Why this is a recovery task, not a replay

Task `ASTER-20261102-001` claimed successfully and ran Codex, which exited
with code 0 but left the laptop worktree **dirty**. No new source commit was
pushed. Its immutable GitHub report is `needs-review`:
`coordination/reports/ASTER-20261102-001.json`.

**Do not rerun the previous implementation request.** The uncommitted
changes may contain useful work, failed experiments or partial modifications.
Only the laptop can inspect them. Do not assume they are safe to discard.

## Mandatory preflight

The existing worker must refuse to execute this task if the feature checkout
is dirty or does not exactly match the Base-SHA. This is intentional. Do not
bypass the preflight, change the worker or auto-stash/reset/clean the checkout.

A human must first inspect the local source status and task 001 log:
```bash
systemctl --user disable --now aster-codex-worker.timer
cd /home/puneet/Projects/aster-browser/upstream-browseros
git status --short --branch
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
tail -n 80 ~/.local/state/aster-codex-loop/logs/ASTER-20261102-001.log
```
Preserve the working tree, logs and any user data. No automatic destructive
cleanup or force-push is permitted.

## If the user has already reconciled the checkout safely

Perform **read-only inspection**, not implementation:
1. Verify the exact source SHA and clean state. Confirm that no uncommitted
   task-001 work was lost; if the local changes were committed and pushed,
   this Base-SHA will no longer match and the worker must refuse the task.
2. Read the prior local log and summarize what task 001 actually attempted,
   without leaking credentials or raw private logs into GitHub.
3. Confirm provider-timeout and tab-close-during-read evidence from actual
   repository files. Never claim they passed unless independently verified.
4. Do not modify source, launch builds, start a model provider, commit, reset,
   stash, clean, or attempt the original implementation again.
5. Finish with a concise factual audit. The wrapper may report `pushed`
   for a successful no-op Git push; this **does not** mean any source
   implementation was completed.

## Reviewer hold

This is the only recovery task issued for task 001. If its report is blocked
because the local checkout is still dirty, do not automatically generate a
new recovery ID every hour. Wait for a human-confirmed safe reconciliation
and an exact verified source SHA before issuing new implementation work.

A01/A02 remain PARTIAL; native Aster and real-model evaluation remain open.
