#!/usr/bin/env python3
"""Aster Codex GitHub mailbox worker; one claim per immutable task ID.

Runs on the owner's Linux laptop. It never force-pushes, never switches
branches, never replays a claimed task, and only executes a trusted task from
the owner's aster-control branch.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

REPO = "puneetdixit200/brower"
FEATURE = "feat/aster-linux-ui"
CONTROL = "aster-control"
TASK_PATH = "coordination/next-task.md"
STATE = Path.home() / ".local/state/aster-codex-loop"
TASK_PATTERN = re.compile(r"(?m)^Task-ID: (ASTER-[0-9]{8}-[0-9]{3})$")
BASE_PATTERN = re.compile(r"(?m)^Base-SHA: ([0-9a-f]{40})$")


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def command(argv: list[str], cwd: Path | None = None, stdin: str | None = None,
            timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv, cwd=cwd, input=stdin, text=True, capture_output=True,
        timeout=timeout, check=False,
    )


def git(repo: Path, *args: str) -> str:
    result = command(["git", "-C", str(repo), *args])
    if result.returncode:
        raise RuntimeError("Git command failed: " + " ".join(args) +
                           " (" + result.stderr.strip()[:220] + ")")
    return result.stdout.strip()


def gh_create(path: str, payload: dict[str, Any]) -> None:
    encoded = base64.b64encode(
        (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode()
    ).decode()
    result = command([
        "gh", "api", "-X", "PUT", f"repos/{REPO}/contents/{path}",
        "-f", f"branch={CONTROL}",
        "-f", f"message=chore(aster-control): write {path}",
        "-f", f"content={encoded}",
    ])
    if result.returncode:
        raise RuntimeError(
            "GitHub claim/report create failed: " + result.stderr.strip()[:240]
        )


def online_exists(path: str) -> bool:
    result = command([
        "gh", "api", "-X", "GET", f"repos/{REPO}/contents/{path}",
        "-f", f"ref={CONTROL}", "--jq", ".sha",
    ])
    if result.returncode == 0:
        return True
    if "404" in result.stderr or "Not Found" in result.stderr:
        return False
    raise RuntimeError("GitHub lookup failed: " + result.stderr.strip()[:240])


def send_pending_reports() -> None:
    directory = STATE / "outbox"
    directory.mkdir(parents=True, exist_ok=True)
    for file in sorted(directory.glob("ASTER-*.json")):
        task_id = file.stem
        remote = f"coordination/reports/{task_id}.json"
        if online_exists(remote):
            file.unlink()
            continue
        payload = json.loads(file.read_text(encoding="utf8"))
        gh_create(remote, payload)
        file.unlink()


def save_report(task_id: str, payload: dict[str, Any]) -> None:
    path = STATE / "outbox" / (task_id + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    os.replace(temp, path)
    send_pending_reports()



# Only the trusted wrapper may touch .git. Codex's workspace-write sandbox
# intentionally does not grant .git write access.
ALLOWED_SOURCE_PREFIXES = ("packages/", "docs/", "tools/", "scripts/", "skills/")
MAX_FILES_PER_TASK = 80
MAX_FILE_BYTES = 2_000_000
MAX_TOTAL_BYTES = 8_000_000
SENSITIVE_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".sqlite", ".db", ".log")
SENSITIVE_PARTS = (".git", ".ssh", "node_modules", ".env", ".npmrc",
                   ".netrc", "credentials", "secrets", "tokens")


def git_command(repo: Path, *args: str, timeout: int = 90
                ) -> subprocess.CompletedProcess[str]:
    return command(["git", "-C", str(repo), *args], timeout=timeout)


def commit_codex_changes(repo: Path, task_id: str, expected_head: str
                         ) -> tuple[str | None, list[str]]:
    """Stage bounded source changes and run normal commit hooks outside sandbox.

    The starting checkout was clean and exact-SHA matched; refuse any surprise
    commit, path outside source ownership, secret-looking file, or binary/symlink.
    On failure leave the diff untouched for human inspection, never retry a task.
    """
    if git(repo, "rev-parse", "HEAD") != expected_head:
        raise RuntimeError("HEAD changed during task; preserve all work for review")
    changed = git_command(repo, "diff", "--name-only", "-z", "HEAD", "--")
    unknown = git_command(repo, "ls-files", "--others", "--exclude-standard", "-z")
    if changed.returncode or unknown.returncode:
        raise RuntimeError("Cannot inspect task diff safely")
    files = sorted(set(path for path in
                       (changed.stdout + unknown.stdout).split("\0") if path))
    if not files:
        return None, []
    if len(files) > MAX_FILES_PER_TASK:
        raise RuntimeError("Task changed too many files; inspect manually")

    total_bytes = 0
    for name in files:
        parts = Path(name).parts
        if (not name.startswith(ALLOWED_SOURCE_PREFIXES) or
                Path(name).is_absolute() or ".." in parts or
                any(part in SENSITIVE_PARTS or part.startswith(".env")
                    for part in parts) or
                name.lower().endswith(SENSITIVE_SUFFIXES)):
            raise RuntimeError(f"Refusing to auto-stage sensitive/unowned path: {name}")
        target = repo / name
        if target.is_symlink():
            raise RuntimeError(f"Refusing to auto-stage symlink: {name}")
        if target.exists():
            if not target.is_file():
                raise RuntimeError(f"Not an ordinary file: {name}")
            size = target.stat().st_size
            total_bytes += size
            if size > MAX_FILE_BYTES or total_bytes > MAX_TOTAL_BYTES:
                raise RuntimeError("Source diff exceeds bounded staging size")
    if git_command(repo, "diff", "--check").returncode:
        raise RuntimeError("Git whitespace check failed; source needs review")
    added = git_command(repo, "add", "-A", "--", *files, timeout=120)
    if added.returncode:
        raise RuntimeError("Git staging failed: " + added.stderr.strip()[:260])
    if git_command(repo, "diff", "--cached", "--check").returncode:
        raise RuntimeError("Staged whitespace check failed")
    staged = git_command(repo, "diff", "--cached", "--name-only", "-z")
    staged_files = sorted(x for x in staged.stdout.split("\0") if x)
    if staged.returncode or not staged_files or any(x not in files for x in staged_files):
        raise RuntimeError("Unexpected staged files: preserve index for manual review")
    committed = git_command(
        repo, "commit", "-m", f"feat(aster): implement {task_id.lower()}",
        timeout=300,
    )
    if committed.returncode:
        raise RuntimeError("Commit hooks/commit failed: " + committed.stderr.strip()[:300])
    return git(repo, "rev-parse", "HEAD"), staged_files



def do_work(repo: Path) -> int:
    if not (repo / ".git").exists():
        raise RuntimeError("Expected an ordinary local Aster Git checkout")
    git(repo, "fetch", "--no-tags", "aster",
        f"refs/heads/{FEATURE}:refs/remotes/aster/{FEATURE}",
        f"refs/heads/{CONTROL}:refs/remotes/aster/{CONTROL}")
    task = git(repo, "show", f"refs/remotes/aster/{CONTROL}:{TASK_PATH}")
    id_match, base_match = TASK_PATTERN.search(task), BASE_PATTERN.search(task)
    if not id_match or not base_match:
        raise RuntimeError("Control task missing strict Task-ID or Base-SHA")
    task_id, base = id_match.group(1), base_match.group(1)
    claim_path = f"coordination/claims/{task_id}.json"
    report_path = f"coordination/reports/{task_id}.json"

    # At-most-once admission. Incomplete claims are never retried blindly.
    if online_exists(report_path) or online_exists(claim_path):
        print(f"{task_id}: already claimed/completed; no automatic replay")
        return 0

    branch = git(repo, "branch", "--show-current")
    head = git(repo, "rev-parse", "HEAD")
    remote_head = git(repo, "rev-parse", f"refs/remotes/aster/{FEATURE}")
    dirty = bool(git(repo, "status", "--porcelain=v1"))
    condition = (
        "ready" if branch == FEATURE and head == remote_head == base and
        not dirty else "blocked"
    )
    reason = (
        "safe source checkout verified" if condition == "ready"
        else "branch, source SHA, or working tree differs from task baseline"
    )
    gh_create(claim_path, {
        "schema": 1, "task_id": task_id, "base_sha": base,
        "claimed_at": timestamp(), "preflight": condition,
        "preflight_reason": reason,
    })

    report: dict[str, Any] = {
        "schema": 1, "task_id": task_id, "base_sha": base,
        "started_at": timestamp(), "status": condition,
        "observed_head": head, "observed_remote": remote_head,
        "source_branch": branch, "dirty_at_start": dirty,
        "finished_at": None, "end_sha": head,
    }
    try:
        if condition != "ready":
            report["status"] = "blocked"
            report["reason"] = reason
            print(f"{task_id}: {reason}. Waiting for new instructions.")
            return 2

        binary = os.environ.get("ASTER_CODEX_BIN", "") or shutil.which("codex")
        if not binary:
            report["status"] = "blocked"
            report["reason"] = "Codex CLI not found in service PATH"
            return 2
        prompt = (
            "You are the local Aster coding agent. Follow the trusted GitHub "
            "coordination task below. Do not edit the control branch. "
            "Work only in the verified feature branch. Read authoritative "
            "docs and actual code; do not hallucinate. Produce reviewed "
            "implementation, focused tests, and evidence. DO NOT git add, "
            "commit or push inside the sandbox: .git is intentionally "
            "read-only. The trusted wrapper validates, commits and "
            "normally pushes changed source after you exit. If blocked, "
            "stop and explain, do not bypass security. Max three Luna-medium "
            "subagents if such workers are actually available; never "
            "substitute Sol or Terra. End with a factual concise report.\n\n"
            + task
        )
        log = STATE / "logs" / (task_id + ".log")
        log.parent.mkdir(parents=True, exist_ok=True)
        environment = os.environ.copy()
        environment["PATH"] = (
            str(Path.home() / ".local/bin") + ":" +
            str(Path.home() / ".npm-global/bin") + ":" +
            environment.get("PATH", "")
        )
        print(f"{task_id}: starting local Codex; log stored locally at {log}")
        with log.open("w", encoding="utf8") as stream:
            ran = subprocess.run(
                [binary, "exec", "--sandbox", "workspace-write",
                 "-C", str(repo), "-"],
                input=prompt, text=True, stdout=stream, stderr=subprocess.STDOUT,
                cwd=repo, env=environment, check=False,
            )
        report["codex_exit_code"] = ran.returncode
        report["end_sha"] = git(repo, "rev-parse", "HEAD")
        report["dirty_at_end"] = bool(git(repo, "status", "--porcelain=v1"))
        report["branch_at_end"] = git(repo, "branch", "--show-current")
        if ran.returncode != 0 or report["branch_at_end"] != FEATURE:
            report["status"] = "needs-review"
            report["reason"] = "Codex exited with error or changed source branch"
            return 1

        # Codex workspace-write cannot modify .git. Only this unsandboxed,
        # preflight-verified wrapper may create a normal source commit.
        new_head, changed_files = commit_codex_changes(repo, task_id, head)
        report["changed_file_count"] = len(changed_files)
        if new_head is None:
            report["status"] = "no-changes"
            report["reason"] = "Codex created no new source changes; no implementation commit"
            return 1
        report["committed_by_worker"] = True
        report["end_sha"] = new_head
        report["dirty_at_end"] = bool(git(repo, "status", "--porcelain=v1"))
        if report["dirty_at_end"]:
            report["status"] = "needs-review"
            report["reason"] = "Commit hooks changed worktree after commit"
            return 1
        else:
            push = command([
                "git", "-C", str(repo), "push", "aster",
                f"HEAD:refs/heads/{FEATURE}",
            ], timeout=120)
            report["push_ok"] = push.returncode == 0
            report["status"] = "pushed" if push.returncode == 0 else "push-rejected"
            if push.returncode:
                report["reason"] = push.stderr.strip()[:400]
            else:
                git(repo, "fetch", "--no-tags", "aster",
                    f"refs/heads/{FEATURE}:refs/remotes/aster/{FEATURE}")
                report["remote_sha_after"] = git(
                    repo, "rev-parse", f"refs/remotes/aster/{FEATURE}"
                )
                if report["remote_sha_after"] != report["end_sha"]:
                    report["status"] = "needs-review"
                    report["reason"] = "Remote SHA differs after push"
        print(f"{task_id}: {report['status']}, source {report['end_sha']}")
        return 0 if report["status"] == "pushed" else 1
    except Exception as exc:
        report["status"] = "needs-review"
        report["reason"] = str(exc)[:420]
        return 1
    finally:
        report["finished_at"] = timestamp()
        try:
            save_report(task_id, report)
        except Exception as exc:
            # Durable local outbox is preserved for the next 30-minute poll.
            print(f"Report queued locally; GitHub unavailable: {exc}", file=sys.stderr)


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    lock = STATE / "worker.lock"
    with lock.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Aster worker is already running; skip duplicate timer tick.")
            return 0
        try:
            for dependency in ("git", "gh"):
                if not shutil.which(dependency):
                    raise RuntimeError(f"Required executable missing: {dependency}")
            send_pending_reports()
            return do_work(args.repo.expanduser().resolve())
        except Exception as exc:
            print(f"Aster worker preflight error: {exc}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
