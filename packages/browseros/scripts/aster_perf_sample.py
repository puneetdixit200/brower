#!/usr/bin/env python3
"""Record numeric Linux process-tree CPU/RSS samples without browser privileges.

This does NOT measure page load, actual UI input latency, or startup readiness.
Sum of RSS double-counts shared Chromium memory; compare under identical
hardware/profiles/conditions and record raw traces rather than claim a win.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
from pathlib import Path
import statistics
import sys
import time


def _proc_stat(pid: int) -> tuple[int, int] | None:
    """Return (utime+stime ticks, resident pages) from /proc/pid/stat."""
    try:
        stat = Path("/proc") / str(pid) / "stat"
        raw = stat.read_text(encoding="ascii")
        fields = raw[raw.rfind(")") + 2 :].split()
        return int(fields[11]) + int(fields[12]), int(fields[21])
    except (FileNotFoundError, ProcessLookupError, PermissionError, IndexError, ValueError):
        return None


def _children(pid: int) -> list[int]:
    path = Path("/proc") / str(pid) / "task" / str(pid) / "children"
    try:
        return [int(p) for p in path.read_text(encoding="ascii").split()]
    except (FileNotFoundError, ProcessLookupError, PermissionError, ValueError):
        return []


def _tree_pids(root: int) -> set[int]:
    visited: set[int] = set()
    pending = [root]
    while pending:
        pid = pending.pop()
        if pid in visited:
            continue
        visited.add(pid)
        pending.extend(_children(pid))
        if len(visited) > 2048:
            raise RuntimeError("Process tree too large; refusing unbounded collection")
    return visited


def _snapshot(pid: int) -> tuple[int, int, int]:
    ticks, pages, processes = 0, 0, 0
    for current in _tree_pids(pid):
        record = _proc_stat(current)
        if record is None:
            continue
        ticks += record[0]
        pages += record[1]
        processes += 1
    if not processes:
        raise ProcessLookupError(f"Browser process {pid} and children are unavailable")
    return ticks, pages * os.sysconf("SC_PAGE_SIZE"), processes


def _quantile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = (len(sorted_values) - 1) * p
    low = int(index)
    high = min(low + 1, len(sorted_values) - 1)
    fraction = index - low
    return sorted_values[low] * (1 - fraction) + sorted_values[high] * fraction


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True, help="Root browser PID")
    parser.add_argument("--label", required=True, help="aster or upstream (no secrets)")
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--output", type=Path, help="Directory for CSV and JSON")
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("Linux /proc is required")
    if args.pid <= 0 or not (1 <= args.seconds <= 1800):
        parser.error("Require a real PID and 1-1800 measurement seconds")
    if not (0.1 <= args.interval <= 5):
        parser.error("Sampling interval must be between 0.1 and 5 seconds")
    if not args.label.isascii() or not args.label.replace("-", "").replace("_", "").isalnum():
        parser.error("Label must be alphanumeric, underscores or hyphens")

    root = (
        args.output
        or Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state")))
        / "aster-browser" / "benchmarks"
    ).expanduser()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prefix = root / (args.label + "-" + stamp)
    trace = prefix.with_suffix(".csv")
    summary_file = prefix.with_suffix(".json")
    hz = os.sysconf("SC_CLK_TCK")
    samples: list[dict[str, float | int]] = []
    print(f"Writing trace {trace} for {args.seconds:.0f} seconds")

    start = time.monotonic()
    previous_time = start
    previous_ticks, _, _ = _snapshot(args.pid)
    try:
        with trace.open("x", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=["elapsed_s", "cpu_pct_one_core", "rss_sum_mb", "processes"],
            )
            writer.writeheader()
            while time.monotonic() - start < args.seconds:
                time.sleep(args.interval)
                current_time = time.monotonic()
                ticks, rss, processes = _snapshot(args.pid)
                delta = max(current_time - previous_time, 0.0001)
                cpu = max(0, ticks - previous_ticks) / hz / delta * 100
                row = {
                    "elapsed_s": round(current_time - start, 3),
                    "cpu_pct_one_core": round(cpu, 2),
                    "rss_sum_mb": round(rss / 1048576, 2),
                    "processes": processes,
                }
                writer.writerow(row)
                samples.append(row)
                previous_time, previous_ticks = current_time, ticks
    except KeyboardInterrupt:
        print("Sampling interrupted; preserving partial trace.", file=sys.stderr)
    except ProcessLookupError as exc:
        print(f"Browser exited: {exc}. Preserving partial trace.", file=sys.stderr)

    cpu_values = [float(x["cpu_pct_one_core"]) for x in samples]
    rss_values = [float(x["rss_sum_mb"]) for x in samples]
    summary = {
        "label": args.label,
        "pid_at_capture_start": args.pid,
        "sample_count": len(samples),
        "requested_seconds": args.seconds,
        "interval_seconds": args.interval,
        "cpu_pct_one_core_p50": _quantile(cpu_values, 0.50),
        "cpu_pct_one_core_p95": _quantile(cpu_values, 0.95),
        "rss_sum_mb_p50": _quantile(rss_values, 0.50),
        "rss_sum_mb_p95": _quantile(rss_values, 0.95),
        "max_processes": max((int(x["processes"]) for x in samples), default=None),
        "limitations": [
            "Linux process-tree RSS double-counts shared Chromium pages",
            "CPU 100% equals one fully busy logical core",
            "Does not measure visual responsiveness, startup ready, or page-load latency",
            "Only a comparable baseline with identical workload/hardware supports a claim",
        ],
    }
    summary_file.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if samples else 1


if __name__ == "__main__":
    sys.exit(main())
