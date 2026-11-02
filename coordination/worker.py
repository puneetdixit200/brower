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
            "implementation, focused tests, and evidence. Commit with "
            "Conventional Commits, without force pushing. If blocked, "
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
        if ran.returncode != 0 or report["dirty_at_end"] or                 report["branch_at_end"] != FEATURE:
            report["status"] = "needs-review"
            report["reason"] = "Codex nonzero exit, dirty worktree, or branch changed"
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
