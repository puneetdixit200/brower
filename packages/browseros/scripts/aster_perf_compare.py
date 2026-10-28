#!/usr/bin/env python3
"""Compare measured browser memory/CPU or startup samples honestly.

Input is numeric JSON produced by aster_perf_sample.py or
aster_startup_probe.py. Never infer speedups without matching workloads.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def numeric(obj: dict, key: str) -> float:
    value = obj.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"Missing numeric metric {key}")
    if value < 0: raise ValueError(f"Negative metric {key}")
    return float(value)


def compare(a: dict, b: dict) -> dict:
    if a.get("label") != "upstream" or b.get("label") != "aster":
        raise ValueError("Use an upstream baseline and Aster sample, in that order")
    keys = (
        ("cpu_pct_one_core_p50", "cpu_pct_one_core_p95",
         "rss_sum_mb_p50", "rss_sum_mb_p95")
        if "cpu_pct_one_core_p50" in a else
        ("mean_ready_ms", "minimum_ready_ms", "maximum_ready_ms")
    )
    if any(key not in a or key not in b for key in keys):
        raise ValueError("Both samples must contain the same measurement type")
    if keys[0] == "mean_ready_ms" and a.get("measurement") != b.get("measurement"):
        raise ValueError("Incompatible startup readiness measurement definitions")
    result = {}
    for key in keys:
        baseline, candidate = numeric(a, key), numeric(b, key)
        result[key] = {
            "upstream": baseline,
            "aster": candidate,
            "delta": round(candidate - baseline, 3),
            "delta_percent": (
                round((candidate / baseline - 1)*100, 2)
                if baseline > 0 else None
            ),
        }
    return {
        "comparison": result,
        "evidence_level": "numeric measurements, NOT release acceptance",
        "limitations": [
            "Operator must ensure equal hardware, load, profiles and workloads",
            "CPU/RSS traces sum subprocess RSS and double-count shared pages",
            "CDP readiness is not first paint, tab-switch latency or perceived speed",
            "No PASS decision is made automatically",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--aster", required=True, type=Path)
    args = parser.parse_args()
    a = json.loads(args.upstream.read_text(encoding="utf8"))
    b = json.loads(args.aster.read_text(encoding="utf8"))
    print(json.dumps(compare(a, b), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
