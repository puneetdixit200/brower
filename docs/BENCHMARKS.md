# Benchmarks

## Current evidence

- Host: AMD Ryzen 5 5500U, 14 GiB RAM, AMD Lucienne integrated graphics; see [`environment.txt`](environment.txt).
- No matched Aster-versus-stock browser navigation, warm-start, tab-switch, or idle CPU/RSS benchmark has been recorded.
- WXT extension build: 72.84 seconds with Node heap capped at 4 GiB; this is a build-time observation, not a browser performance result. First attempt exited 134 from V8 heap exhaustion under the default cap.
- Build peaked near 3.6 GiB Node RSS during retry; other desktop processes were active, so this should not be treated as a clean resource benchmark.
- Stock BrowserOS GPU info reported AMD/Mesa acceleration, but no comparative frame/input latency measurement was captured.

## Required next measurements

Use the same isolated profile state and fixture set for stock and Aster. Record at least five warm and cold launches, navigation timings over a local deterministic fixture, tab toggle latency, five-minute idle CPU/RSS, and 10-tab memory. Preserve raw JSON/CSV and report medians plus p95. Do not claim a performance budget passes until measured on the target desktop.
