# Benchmarks

## Current evidence

- Host: AMD Ryzen 5 5500U, 14 GiB RAM, AMD Lucienne integrated graphics; see [`environment.txt`](environment.txt).
- Aster home Search input proxy benchmark: 100 synthetic input events after 10 warmups on BrowserOS v0.51.0 / Chromium 155.0.8309.26 in a headed Wayland development profile. Median 16.7 ms, p95 17.3 ms, max 17.6 ms. Raw samples: [`perf/aster-home-input-2026-10-27.json`](perf/aster-home-input-2026-10-27.json).
- This number measures input-event dispatch through the next animation frame and verifies that React enabled the Search action. It is not physical keyboard latency, compositor presentation, or an Aster-versus-stock comparison; do not treat it as proof that the complete <50 ms visible-response target passes.
- Local memory FTS search on the same Ryzen 5 5500U host: synthetic SQLite datasets of 10,000 and 50,000 notes, 120 measured searches after 20 warmups, 8 results requested, with production migrations and FTS triggers. At 10k entries median was 1.357 ms / p95 1.657 ms / max 1.842 ms; at 50k median was 7.470 ms / p95 8.330 ms / max 9.902 ms. The temporary DB lived under `/tmp` (tmpfs); results represent warm local search, not durable-disk cold reads or UI responsiveness. Raw ordered samples and index build times: [`perf/aster-memory-search-2026-10-27.json`](perf/aster-memory-search-2026-10-27.json). Reproduce with `bun tests/perf/memory-search.bench.ts` from `packages/browseros-agent/apps/server`.
- No matched Aster-versus-stock browser navigation, warm-start, tab-switch, or idle CPU/RSS benchmark has been recorded.
- WXT extension build: 72.84 seconds with Node heap capped at 4 GiB; this is a build-time observation, not a browser performance result. First attempt exited 134 from V8 heap exhaustion under the default cap.
- Build peaked near 3.6 GiB Node RSS during retry; other desktop processes were active, so this should not be treated as a clean resource benchmark.
- Stock BrowserOS GPU info reported AMD/Mesa acceleration, but no comparative frame/input latency measurement was captured.

## Required next measurements

Run `python tests/e2e/aster_ui_latency_benchmark.py --cdp-port <port> --iterations 100 --warmup 10 --output docs/perf/<run>.json` against a disposable headed dev profile. For isolated network-namespace runs, execute the benchmark with `nsenter -t <browser-pid> -n` so it reaches loopback inside that namespace.

Use the same isolated profile state and fixture set for stock and Aster. Record at least five warm and cold launches, navigation timings over a local deterministic fixture, tab toggle latency, five-minute idle CPU/RSS, and 10-tab memory. Preserve raw JSON/CSV and report medians plus p95. Do not claim a performance budget passes until measured on the target desktop.
