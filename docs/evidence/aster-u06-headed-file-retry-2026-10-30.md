# U06 headed file retry smoke — 2026-10-30

## Result

The disposable headed BrowserOS retry smoke passed. It stages a synthetic text attachment, submits it through the extension to the real Bun sidecar, and uses a loopback OpenAI-compatible fixture that returns HTTP 503 for the active file request until the UI exposes “Try again.” The model SDK makes its initial attempt and two automatic retries; after those fail, the harness enables fixture success and clicks the actual UI retry button. The second `/chat` request succeeds.

Exact smoke output:

```json
{"headed_retry_after_provider_request_failure":"passed","actual_ui_retry_button":"clicked","chat_requests":2,"provider_sdk_automatic_503_retries":2,"provider_attempt_statuses":[503,503,503,200],"user_triggered_retry_success":"verified","active_marker_once_in_failed_and_retry_requests":"verified","older_attachment_replay":"not exercised in this headed journey; covered by request unit tests","synthetic_fixture":"aster-active-ba2d97da.txt"}
```

The focused request test separately confirms that the active-turn attachment projection retains the latest user message's file and excludes older-turn files. This headed journey has only one attached user turn, so older-file exclusion is not claimed as headed evidence.

## Harness and runtime

- Harness: `packages/browseros-agent/tools/dev/smokes/aster_file_attachment_retry_smoke.py`.
- Runtime: BrowserOS v0.51.0 through `tools/dev/linux/run.sh --new`, a fresh disposable profile, and the real Bun sidecar.
- Browser egress used the local-only wrapper and host-resolver rules to block external names while allowing loopback; this is not a kernel network namespace.
- The fixture provider bound only to `127.0.0.1` on an ephemeral port. A test-only loopback control route allows the provider to return success only after the UI retry appears. It records in-memory request objects and emits no request bodies or marker values.
- The attachment contained a synthetic marker only. A dummy API key was accepted by the local fixture. No external model or real credential was used.
- Final lead rerun used CDP port `9134` and sidecar port `9717`. The runner was shut down with Ctrl+C; its BrowserOS, sidecar, and profile were task-owned disposable processes/state.

## Evidence boundary

This verifies the BrowserOS headed client → sidecar → local provider retry journey, including the explicit UI retry and active attachment delivery. It does not verify retry after a mid-SSE stream interruption; the failure is an HTTP 503 before an SSE response begins. The three 503 attempts include two automatic SDK retries. It does not verify multi-turn old-file exclusion in a headed run, the native file chooser, linked Aster Chromium, packaged sandbox/privacy behavior, or release identity. U06 remains PARTIAL.

Reproduction uses the disposable runner with `ASTER_BROWSER_BIN=/tmp/aster-browseros-local-only`, a temporary `XDG_CACHE_HOME`, and `BROWSEROS_USE_MOCK_LLM=false`, then runs the smoke with the runner's printed CDP and server ports.
