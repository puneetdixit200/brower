#!/usr/bin/env python3
"""Restricted Aster development-tab REPL using an ephemeral Chromium profile.

Only tabs/open/activate/close/quit. No arbitrary JS, Python eval, shell
execution, credentials, or connections to anyone else's browser profile.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import tempfile
import time
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


def request(port: int, path: str, *, method: str = "GET"):
    with urlopen(
        Request(f"http://127.0.0.1:{port}{path}", method=method), timeout=4,
    ) as response:
        return json.loads(response.read(1_000_000).decode()) if path == "/json/list" else response.read(2048).decode()


def start(binary: Path, profile: Path, ozone: str) -> subprocess.Popen:
    args = [
        str(binary), f"--user-data-dir={profile}",
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check",
        "--ozone-platform-hint=auto" if ozone == "auto" else f"--ozone-platform={ozone}",
        "about:blank",
    ]
    return subprocess.Popen(
        args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def parse_command(line: str) -> list[str]:
    """Split one command line; input is never evaluated as Python or shell."""
    try:
        return shlex.split(line)
    except ValueError as error:
        raise ValueError("Invalid command") from error


def validate_command(words: list[str]) -> tuple[str, list[str]]:
    """Validate an operation before it can reach the local DevTools socket."""
    if not words:
        return "", []
    command, *params = words
    if command in ("exit", "quit") and not params:
        return "quit", []
    if command == "tabs" and not params:
        return command, params
    if command == "open" and len(params) == 1:
        value = params[0]
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or len(value) > 2048
            or any(ord(char) < 0x20 for char in value)
        ):
            raise ValueError("Only bounded HTTPS URLs are permitted")
        return command, params
    if command in ("activate", "close") and len(params) == 1:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,256}", params[0]):
            raise ValueError("Invalid target ID")
        return command, params
    raise ValueError("Use tabs, open <https-url>, activate <id>, close <id> or quit")


def dispatch_command(port: int, words: list[str], emit=print) -> bool:
    """Dispatch one safe command; return False when the session should end."""
    if not words:
        return True
    try:
        command, params = validate_command(words)
        if command == "quit":
            return False
        if command == "tabs":
            items = request(port, "/json/list")
            emit(json.dumps([
                {"id": item.get("id"), "type": item.get("type"),
                 "title": str(item.get("title", ""))[:120]}
                for item in items[:100]
            ], indent=2))
        elif command == "open":
            path = "/json/new?" + quote(params[0], safe="")
            emit(request(port, path, method="PUT")[:500])
        else:
            action = "activate/" if command == "activate" else "close/"
            emit(request(port, "/json/" + action + params[0])[:500])
    except (ValueError, OSError) as error:
        emit(f"Action rejected or unavailable: {error}")
    return True


def _process_group_exists(process_group_id: int) -> bool:
    try:
        os.killpg(process_group_id, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # The group exists even if this process cannot signal it.
        return True


def stop(process: subprocess.Popen, timeout: float = 8) -> None:
    """Stop and reap the owned process group, including orphaned children."""
    process_group_id = process.pid
    try:
        os.killpg(process_group_id, signal.SIGTERM)
    except ProcessLookupError:
        pass

    deadline = time.monotonic() + timeout
    while _process_group_exists(process_group_id) and time.monotonic() < deadline:
        # poll() reaps an exited leader but does not imply its process group is gone.
        process.poll()
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))

    if _process_group_exists(process_group_id):
        try:
            os.killpg(process_group_id, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def run_repl(binary: Path, ozone: str, input_fn=input, emit=print) -> None:
    with tempfile.TemporaryDirectory(prefix="aster-repl-dev-") as root:
        profile = Path(root) / "profile"
        profile.mkdir(mode=0o700)
        process = start(binary, profile, ozone)
        try:
            port = locate_port(profile, process)
            emit("Aster disposable-profile REPL. Commands: tabs, open <https-url>, activate <id>, close <id>, quit.")
            while process.poll() is None:
                try:
                    words = parse_command(input_fn("aster-dev> ").strip())
                except (EOFError, KeyboardInterrupt):
                    break
                except ValueError:
                    emit("Invalid command")
                    continue
                if not dispatch_command(port, words, emit):
                    break
        finally:
            stop(process)


def locate_port(profile: Path, process: subprocess.Popen) -> int:
    pin = profile / "DevToolsActivePort"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Development browser exited before opening DevTools")
        if pin.is_file():
            value = pin.read_text().splitlines()[0].strip()
            if value.isdigit() and 1 <= int(value) <= 65535:
                port = int(value)
                request(port, "/json/list")
                return port
        time.sleep(.1)
    raise RuntimeError("Timed out waiting for isolated development browser")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--ozone", choices=("auto", "wayland", "x11"), default="auto")
    args = parser.parse_args()
    binary = args.binary.expanduser().resolve(strict=True)
    if not binary.is_file() or not os.access(binary, os.X_OK):
        parser.error("Must provide an executable Aster development binary")
    run_repl(binary, args.ozone)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
