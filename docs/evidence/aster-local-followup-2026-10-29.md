# Aster local source follow-up — 2026-10-29

Fetched 29 commits and fast-forwarded `feat/aster-linux-ui` from
`9ee82a38f` to `7c32461df`. The checks below cover the local working tree
based on that fetched commit, including local review fixes not yet in HEAD.

## Verified in the local working tree

- Scheduler checks: **20 tests, 60 assertions** pass. Capped stale cleanup
  prioritizes orphan records without a conversation ID; every pass remains
  bounded.
- Research checks: **22 tests, 56 assertions** pass. Fragment variants are
  deduplicated by canonical evidence URL.
- `@browseros/app` typecheck, targeted Biome, and `git diff --check` pass.

## Status and limits

R02/R03 and A11 remain **PARTIAL**. Scheduler cleanup has no cross-process
runtime proof. Native/package behavior, forced restart during a live
provider/sidecar run, and live-provider behavior remain unverified. Research
URL/quote provenance does not establish semantic claim support or truth; that
support gate remains open. Keep matrix status at **2/72 PASS (2.8%)**.
