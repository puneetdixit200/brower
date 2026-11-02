# Install the Aster Codex worker on Omarchy (one time)

**Use a trusted local terminal.** Review `coordination/worker.py` first; it
runs `codex exec` on tasks created by the authorized GitHub reviewer.

Prerequisites: Python 3, `git`, GitHub CLI (`gh`), Codex CLI, and systemd user
services. Authenticate locally using `gh auth login` and `codex login`.
The `aster` Git remote must point to the user's fork, `origin` to upstream.

Run these commands from your normal user account:

```bash
cd /home/puneet/Projects/aster-browser/upstream-browseros
git fetch aster feat/aster-linux-ui aster-control
mkdir -p ~/.local/bin ~/.config/systemd/user
git show aster/aster-control:coordination/worker.py > ~/.local/bin/aster-codex-worker.py
chmod 700 ~/.local/bin/aster-codex-worker.py
git show aster/aster-control:coordination/aster-codex-worker.service > ~/.config/systemd/user/aster-codex-worker.service
git show aster/aster-control:coordination/aster-codex-worker.timer > ~/.config/systemd/user/aster-codex-worker.timer
python3 -m py_compile ~/.local/bin/aster-codex-worker.py
gh auth status
codex login status
systemctl --user daemon-reload
systemctl --user enable --now aster-codex-worker.timer
systemctl --user list-timers aster-codex-worker.timer
```

You may trigger the first poll manually:
`systemctl --user start aster-codex-worker.service`

Inspect activity:
`journalctl --user -u aster-codex-worker.service -n 60 --no-pager`
and `ls ~/.local/state/aster-codex-loop/logs/`.

Stop automation without deleting any work:
`systemctl --user disable --now aster-codex-worker.timer`.

If you want it to run after logout, use the system-approved `loginctl
enable-linger $USER` setting. It cannot execute while the laptop is powered
off or suspended; the pending task resumes only after the computer runs.

If your Codex executable is not discoverable by the service, set its absolute
path using a systemd user service override:
`systemctl --user edit aster-codex-worker.service` and set
`Environment=ASTER_CODEX_BIN=/absolute/path/to/codex`, then reload.

No tokens are ever copied into the public repository. The worker is safe by
default: it requires an exact source SHA and clean checkout, one immutable
claim per task, workspace-write Codex sandbox, and a normal non-force push.

## Important 2026-11-02 repair (before restart)

The original worker asked Codex to `git commit` from a workspace-write
sandbox where `.git` is read-only. That caused task 001 to leave a dirty
checkout; task 002 correctly blocked. The control-branch worker has been
revised to **commit source edits from the trusted wrapper after Codex exits**.

Do **not** resume the timer while uncommitted task-001 changes remain.
Review and reconcile those files manually first. The revised worker does
not automatically retry task 001 or task 002.

With the timer disabled, update the worker safely:

```bash
cd /home/puneet/Projects/aster-browser/upstream-browseros
git fetch aster aster-control
git show aster/aster-control:coordination/worker.py > /tmp/aster-worker-update.py
PYTHONPYCACHEPREFIX="$HOME/.cache/aster-worker-pycache" python3 -m py_compile /tmp/aster-worker-update.py
install -m 700 /tmp/aster-worker-update.py "$HOME/.local/bin/aster-codex-worker.py"
systemctl --user daemon-reload
```

The test file lives on `aster-control`, not necessarily the source checkout.
If testing locally, fetch it through `git show` into a temporary test
directory next to the worker or inspect the passing GitHub Actions control
worker safety run. Do not merge the control branch into the feature branch.

Only after a human has reconciled task-001 source changes and ChatGPT has
published a **new task ID with the updated exact source SHA**, reenable the
timer using `systemctl --user enable --now aster-codex-worker.timer`.

The wrapper's automatic staging policy intentionally refuses files outside
the source/docs allowlist, sensitive or oversized files, symlinks, changed
HEADs, failed normal commit hooks and no-op runs. These cases require
manual review; no automatic reset, force push or claim replay is permitted.
