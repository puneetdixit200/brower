# R02 heartbeat continuation and P03 credential boundary — source checkpoint (2026-10-28)

This checkpoint describes the current uncommitted source changes in the local `feat/aster-linux-ui` checkout. It is implementation progress, not completion of the Aster browser goal.

## R02 — heartbeat continues an existing task (PARTIAL)

- Scheduled jobs now distinguish ordinary `task` runs from `heartbeat` runs. The scheduled-task UI exposes the mode, and the job/run records persist a conversation ID so heartbeat turns can continue the same conversation.
- A heartbeat run checks the latest prior run for that job. The first run and a `completed` run may continue; `running`, `failed`, unknown, and unavailable run history fail closed. The heartbeat path requests persistence of the scheduled conversation and treats persistence failure as an error.
- App and server typechecks passed, and 52 focused tests passed for this source batch. The pinned Chromium patch set applies to pristine pinned inputs.
- Disposable SQLite fresh creation and the actual v18-to-0019 upgrade passed, retaining legacy rows/defaults; a `DbConversationStore` transcript survived close/reopen. An existing database rewind-test fixture initially failed because rollback left 0019 columns behind; the fixture was fixed and rerun. The expanded server suite passes 61/61 and server typecheck passes on rerun; an earlier intermittent TS2589 did not recur.
- No native compile or browser test was run for these new changes. In-flight tool replay, distributed leases/ownership, approval recovery, and restart acceptance are not implemented or verified. A failed/interrupted run deliberately requires review; it is not automatically resumed. Therefore R02 is PARTIAL, not PASS.

## P03 — automated origin-safe blind autofill (NOT_STARTED)

- The Aster-only Chromium patch guard rejects direct Autofill `list`, `add`, and `fill` operations with `approval_unavailable`; the legacy BrowserOS behavior remains outside this Aster guard. This is a fail-closed boundary, not an autofill implementation or user-consent flow.
- Aster must keep these operations unavailable until real browser-owned credential selection and consent are implemented and validated. Do not expose stored passwords to extension JavaScript or model content as a substitute.
- The patch applies to pristine pinned inputs, but the native checkout has not yet had these new changes applied. No native compile or browser test has run. P03 remains NOT_STARTED.

## U02 — nested bookmark folders in sidebar (PARTIAL)

- The sidebar bookmark group now drills into nested folders and provides a back action while retaining global search. It opens only HTTP(S) bookmarks and applies the existing private-window guard.
- Following an independent-review fix, six focused tests pass (6/6), along with Biome and app typecheck. Native integration and headed browser verification remain pending; U02 stays PARTIAL.

## Next validation and implementation

1. Inspect the pinned native checkout and actual build processes before staging anything. Apply the latest reviewed source/patch changes through the normal native pipeline; verify patch provenance and the target Chromium revision.
2. Generate GN as needed, compile the changed Autofill translation unit and focused DevTools browser-test target, then run the focused native test. Continue with the pinned two-job browser build only after the focused checks pass; do not share the Ninja output directory with another live build.
3. Stage the matching app/server resources and launch the resulting Aster binary with a disposable profile. Verify ordinary scheduled tasks still create separate conversations, heartbeat runs retain one conversation ID across a completed run, and failed/interrupted runs stop without replay. Exercise scheduled-task mode selection, history, failure UI, persistence, and restart behavior in the actual browser.
4. Through Aster's live browser-owned DevTools path, verify `list`, `add`, and `fill` each fail with `approval_unavailable`; verify the corresponding BrowserOS behavior is unchanged. A later P03 implementation needs real browser-owned consent and origin binding before any operation can be enabled.
5. Continue the complete 95-subtask plan and remaining matrix rows. Keep native linking/runtime, broader live feature tests, privacy/security acceptance, performance, signing and update ownership open until verified.

Use Luna medium for implementation, focused checks, and documentation, with independent review as requested. At 5% remaining account allowance, checkpoint source and docs, record exact next steps and live process state, stop owned builds/tests/agents, push if that is the active user instruction, and pause; never call the overall project complete at that threshold.
