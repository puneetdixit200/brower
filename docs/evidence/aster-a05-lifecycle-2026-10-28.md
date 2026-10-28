# A05 persisted run lifecycle and interrupted transcript display — 2026-10-28

## Scope and status

The current **uncommitted** A05 source work adds durable server lifecycle metadata and lets the app display the saved transcript of an interrupted run. It improves recovery visibility, but does not restore execution. A05 remains **PARTIAL**, and the source is pending parent review.

## Behavior in this checkpoint

- Migration `0020_add_conversation_run_state.sql` adds lifecycle storage keyed by conversation and run identity. The persisted fields are identifiers, status and timestamps; the table does not save stream buffers, tool calls/results, approval state, leases or ownership.
- Server startup reconciles rows left `running` to `interrupted`.
- The app accepts an `interrupted` lifecycle state, fetches the associated saved conversation transcript, and preserves/displays those messages without opening a stream for that run.
- Conversation deletion also removes its lifecycle row and stored conversation.

No stream or tool replay is implemented. Interrupted work does not continue automatically, and this change does not establish recovery of in-flight browser side effects, approvals or execution ownership.

## Focused verification

- Server focused tests: **63 passed**.
- App conversation-run-client tests: **5 passed**.
- App typecheck: passed.
- Server typecheck: passed.
- Targeted Biome check: passed.

These results validate the source-level implementation and focused test coverage. No headed BrowserOS crash/restart smoke, packaged native-browser check, or full execution-recovery acceptance was performed for this checkpoint.

## Next steps

After review, run an app/server integration across an actual server process restart. Verify that startup marks a live leftover run interrupted, that the saved transcript is rendered without opening a replacement stream, and that terminal states/deletions remain authoritative. Verify deletion cleanup and confirm there is no automatic tool replay. Keep A05 partial until those runtime checks and the broader durable execution-recovery requirements are addressed.
