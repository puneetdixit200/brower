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
