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
from urllib.parse import quote
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
    with tempfile.TemporaryDirectory(prefix="aster-repl-dev-") as root:
        profile = Path(root) / "profile"
        profile.mkdir(mode=0o700)
        process = start(binary, profile, args.ozone)
        try:
            port = locate_port(profile, process)
            print("Aster disposable-profile REPL. Commands: tabs, open <https-url>, activate <id>, close <id>, quit.")
            while process.poll() is None:
                try:
                    words = shlex.split(input("aster-dev> ").strip())
                except (EOFError, KeyboardInterrupt):
                    break
                except ValueError:
                    print("Invalid command")
                    continue
                if not words:
                    continue
                cmd, *params = words
                if cmd in ("exit", "quit") and not params:
                    break
                try:
                    if cmd == "tabs" and not params:
                        items = request(port, "/json/list")
                        print(json.dumps([
                            {"id": item.get("id"), "type": item.get("type"),
                             "title": str(item.get("title", ""))[:120]}
                            for item in items[:100]
                        ], indent=2))
                    elif cmd == "open" and len(params) == 1:
                        if not params[0].startswith("https://") or len(params[0]) > 2048:
                            raise ValueError("Only bounded HTTPS URLs are permitted")
                        print(request(port, "/json/new?" + quote(params[0], safe=""), method="PUT")[:500])
                    elif cmd in ("activate", "close") and len(params) == 1:
                        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,256}", params[0]):
                            raise ValueError("Invalid target ID")
                        path = "/json/" + ("activate/" if cmd == "activate" else "close/") + params[0]
                        print(request(port, path)[:500])
                    else:
                        print("Use tabs, open <https-url>, activate <id>, close <id> or quit")
                except (ValueError, OSError) as error:
                    print(f"Action rejected or unavailable: {error}")
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
