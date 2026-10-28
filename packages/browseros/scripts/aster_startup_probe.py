#!/usr/bin/env python3
"""Probe native Chromium startup readiness using disposable profile state.

Measures a DevTools endpoint, NOT first paint or actual input latency.
Runs only a user-supplied executable; never touches a daily browser profile,
turns off sandboxing or terminates unrelated processes.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.request import urlopen


def probe(binary: Path, *, ozone: str, timeout: float) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="aster-startup-probe-") as home:
        profile = Path(home) / "profile"
        profile.mkdir(mode=0o700)
        args = [
            str(binary), f"--user-data-dir={profile}",
            "--remote-debugging-port=0",
            "--no-first-run", "--no-default-browser-check",
            "--ozone-platform-hint=auto" if ozone == "auto"
            else f"--ozone-platform={ozone}",
            "about:blank",
        ]
        start = time.monotonic()
        # Suppress page data, avoid collecting profile logs or tokens.
        with open(os.devnull, "wb") as output:
            process = subprocess.Popen(
                args, stdout=output, stderr=output,
                start_new_session=True,
            )
            endpoint = profile / "DevToolsActivePort"
            ready_ms: float | None = None
            try:
                while time.monotonic() - start < timeout:
                    if process.poll() is not None:
                        raise RuntimeError(
                            f"Browser exited before CDP ready (code {process.returncode})"
                        )
                    if endpoint.exists():
                        lines = endpoint.read_text().splitlines()
                        if lines and lines[0].isdigit():
                            port = int(lines[0])
                            if 0 < port < 65536:
                                try:
                                    with urlopen(
                                        f"http://127.0.0.1:{port}/json/version",
                                        timeout=0.3,
                                    ) as response:
                                        if response.status == 200:
                                            ready_ms = round((time.monotonic() - start)*1000, 2)
                                            break
                                except (OSError, TimeoutError):
                                    pass
                    time.sleep(0.05)
                if ready_ms is None:
                    raise TimeoutError(f"No CDP readiness after {timeout}s")
                return {"cdp_ready_ms": ready_ms, "ozone": ozone}
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=7)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument("--ozone", choices=("auto", "wayland", "x11"), default="auto")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--label", choices=("aster", "upstream"), required=True)
    args = parser.parse_args()
    if not (1 <= args.samples <= 8) or not (3 <= args.timeout <= 90):
        parser.error("samples must be 1-8 and timeout 3-90 seconds")
    binary = args.binary.expanduser().resolve(strict=True)
    if not binary.is_file() or not os.access(binary, os.X_OK):
        parser.error("Binary is missing or not executable")
    results = []
    for _ in range(args.samples):
        results.append(probe(binary, ozone=args.ozone, timeout=args.timeout))
    values = [float(x["cdp_ready_ms"]) for x in results]
    summary = {
        "label": args.label,
        "measurement": "disposable-profile CDP readiness only",
        "samples": results,
        "mean_ready_ms": round(sum(values)/len(values), 2),
        "minimum_ready_ms": min(values),
        "maximum_ready_ms": max(values),
        "sandbox_disabled": False,
        "limitations": [
            "Does not measure rendered first paint, UI responsiveness or tab switching",
            "Each sample starts a disposable first-run profile, not an established warm profile",
            "Results require same hardware, OS, load and build settings to compare",
        ],
    }
    state = Path(os.environ.get("XDG_STATE_HOME", str(Path.home()/".local/state")))
    target = state / "aster-browser" / "benchmarks"
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = target / f"{args.label}-startup-{int(time.time())}.json"
    filename.write_text(json.dumps(summary, indent=2)+"\n")
    print(f"Recorded {filename}")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
