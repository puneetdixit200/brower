#!/usr/bin/env python3
"""Run a monitored, isolated Aster Linux Chromium development build.

Run on the developer's Linux machine. This is not an official release builder.
No signing keys, update feeds, git resets, arbitrary process kills or disabled
sandbox flags are involved. Exit status belongs to the actual native build.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


def _run_capture(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        args, cwd=cwd, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        raise RuntimeError(
            f"Could not inspect checkout ({' '.join(args)}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def _verify_chromium_pin(repo: Path, source: Path) -> None:
    version_file = repo / "packages/browseros/CHROMIUM_VERSION"
    parts = dict(line.split("=", 1) for line in version_file.read_text().splitlines() if line)
    version = ".".join(parts[key] for key in ("MAJOR", "MINOR", "BUILD", "PATCH"))
    try:
        pin = _run_capture(["git", "rev-parse", "--verify", f"refs/tags/{version}^{{commit}}"], source)
        head = _run_capture(["git", "rev-parse", "--verify", "HEAD"], source)
    except RuntimeError as exc:
        raise RuntimeError(f"Cannot verify local Chromium pin {version}: {exc}") from exc
    if head != pin:
        raise RuntimeError(f"Chromium HEAD {head} does not match pinned tag {version} ({pin})")


def _preflight(repo: Path, source: Path, *, provision: str, allow_dirty: bool) -> None:
    if sys.platform != "linux":
        raise RuntimeError("Native Aster development builds require Linux")
    if not (repo / "packages/browseros/pyproject.toml").is_file():
        raise RuntimeError(f"Not an Aster BrowserOS monorepo root: {repo}")
    if not shutil.which("uv") or not shutil.which("bun") or not shutil.which("git"):
        raise RuntimeError("uv, bun and git must be available on PATH")
    branch = _run_capture(["git", "branch", "--show-current"], repo)
    if branch != "feat/aster-linux-ui":
        raise RuntimeError(
            f"Expected feat/aster-linux-ui, found {branch!r}. "
            "Do not build from the wrong branch."
        )
    tracked = _run_capture(["git", "diff", "--name-only", "HEAD", "--"], repo)
    if tracked:
        raise RuntimeError("Source mode requires a clean tracked checkout; commit or stash changes first")
    dirty = _run_capture(["git", "status", "--porcelain"], repo)
    if dirty and not allow_dirty:
        raise RuntimeError(
            "Working tree contains untracked files. Remove or commit them, or pass "
            "--allow-dirty after reviewing them. Never reset automatically."
        )
    if provision == "none":
        if not (source / ".git").exists():
            raise RuntimeError(
                f"Pinned Chromium checkout is missing: {source}. "
                "Use --provision shallow only after reviewing source/disk requirements."
            )
        _verify_chromium_pin(repo, source)
    else:
        if source.exists() and any(source.iterdir()) and not (source / ".git").exists():
            raise RuntimeError(
                "Refusing to provision a nonempty, non-git Chromium source directory"
            )
    available_bytes = shutil.disk_usage(source.parent if source.parent.exists() else repo).free
    # Native Chromium disk footprint is extremely large. An existing checkout
    # may already occupy space; this is an advisory, never a destructive cleanup.
    required_gib = 100 if provision == "shallow" else 35
    if available_bytes < required_gib * 1024**3:
        raise RuntimeError(
            f"Under {required_gib} GiB available for the selected source mode. "
            "Chromium provisioning/builds need substantial disk; free space "
            "outside this tool first."
        )


def _log_path(repo: Path) -> Path:
    state = os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))
    target = Path(state).expanduser() / "aster-browser" / "build-logs"
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    suffix = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    head = _run_capture(["git", "rev-parse", "--short", "HEAD"], repo)
    return target / f"native-debug-{suffix}-{head}.log"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--chromium-src", type=Path, required=True,
        help="Absolute path to pinned Chromium src (not its parent)",
    )
    parser.add_argument(
        "--provision", choices=("none", "shallow"), default="none",
        help="Default reuses an existing checkout; shallow may download many GB",
    )
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--allow-dirty", action="store_true", help="Allow reviewed untracked files; tracked changes remain disallowed")
    args = parser.parse_args()
    if args.jobs < 1 or args.jobs > 8:
        parser.error("--jobs must be between 1 and 8")

    repo = Path(__file__).resolve().parents[3]
    chromium_src = args.chromium_src.expanduser().resolve()
    if not args.chromium_src.is_absolute():
        parser.error("--chromium-src must be an absolute path")
    _preflight(repo, chromium_src, provision=args.provision, allow_dirty=args.allow_dirty)
    log_path = _log_path(repo)
    command = [
        "uv", "run", "browseros", "build",
        "--preset", "debug", "--product", "aster", "--arch", "x64",
        "--resource-mode", "source", "--aster-unpacked-dev",
        "--provision", args.provision, "--no-clean", "--no-sign", "--no-upload",
        "--chromium-src", str(chromium_src),
    ]
    env = os.environ.copy()
    env["BROWSEROS_NINJA_JOBS"] = str(args.jobs)
    env["PYTHONUNBUFFERED"] = "1"
    print(f"GitHub source: {_run_capture(['git', 'rev-parse', 'HEAD'], repo)}")
    print(f"Chromium src: {chromium_src}")
    print(f"Native build log: {log_path}")
    print(f"Build concurrency: {args.jobs}")
    print("This is an UNSIGNED development build. Sandbox remains enabled.")
    started = time.monotonic()
    process = None
    try:
        with log_path.open("x", encoding="utf-8") as logfile:
            logfile.write(f"Command: {' '.join(command)}\n")
            logfile.write(f"Source: {_run_capture(['git', 'rev-parse', 'HEAD'], repo)}\n")
            logfile.flush()
            process = subprocess.Popen(
                command, cwd=repo / "packages/browseros",
                env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
                start_new_session=True,
            )
            assert process.stdout is not None
            for line in process.stdout:
                sys.stdout.write(line)
                logfile.write(line)
                logfile.flush()
            code = process.wait()
            logfile.write(f"\nExit code: {code}\nElapsed: {time.monotonic()-started:.1f}s\n")
            return code
    except KeyboardInterrupt:
        # Only terminate the process group created by this script, never
        # arbitrary Chromium or editor processes on the developer's desktop.
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGINT)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait()
        print(f"\nInterrupted. Review partial log: {log_path}", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
