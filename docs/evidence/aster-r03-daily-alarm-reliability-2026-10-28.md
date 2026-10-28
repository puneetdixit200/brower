# R03 daily alarm reliability evidence — 2026-10-28

R03 remains **PARTIAL**. The app now rebuilds schedules through a periodic
reconciliation alarm when storage is unavailable or daily alarm rearming fails.
An alarm listener captures delivery time before asynchronous work, skips stale
alarms for disabled/deleted jobs, and preserves the existing one-minute
skip-without-catch-up policy. Daily jobs use one-shot alarms recalculated from
their configured local wall time, rather than a fixed 24-hour interval.

Focused schedule tests pass **10/10**. They cover timely/late delivery, storage
unavailability, rearm failure, disabled jobs, UTC daily scheduling, and
deterministic New York spring-forward/fall-back behavior. The app typecheck and
`git diff --check` pass. Independent Luna review identified a disabled-job race;
the added guard and regression test resolve it.

Reconciliation callbacks are exercised at the handler boundary; this does not
prove browser alarm persistence or recovery after a real browser restart. No
headed browser run covered sleep, timezone changes while running, or duplicate
delivery across worker contexts. The in-memory same-job overlap guard is still
worker-local, and missed runs do not have a durable audit record. These limits
keep R03 partial.
