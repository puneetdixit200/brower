# A01 headed BrowserOS UI-to-page-read smoke — 2026-10-30

**Evidence level:** disposable headed BrowserOS v0.51.0 with the real local sidecar, not Aster-native.

The smoke at `packages/browseros-agent/tools/dev/smokes/aster_ui_page_read_smoke.py` configures a temporary OpenAI-compatible provider over loopback, opens a synthetic loopback page, opens the actual side panel, and submits a user prompt through its visible composer. The fixture provider responds with Browser MCP `tabs` (list), then `read` for the listed fixture tab. It emits the final assistant reply only after the read result contains both expected page values; the smoke checks the final rendered assistant text element rather than matching tool output elsewhere in the transcript.

**Observed result: PASS.** On the hardened rerun, the actual headed BrowserOS side panel rendered an answer containing title `Aster UI Page Read Fixture` and sentinel `ASTER_UI_PAGE_READ_SENTINEL_81D2`. The provider received three turns: tool selection, tool result/read selection, and final answer. The reported Browser MCP calls were `tabs` and `read` (two round trips). The harness also checks that both tools were advertised to the provider and waits for the sentinel in the final assistant-text element, not in tool output. A synthetic dummy credential was used; configured provider and page endpoint URLs were bound to `127.0.0.1`. Redirects are not blocked, and this is not an egress-enforcement claim.

Run against disposable BrowserOS with CDP on 9717 and sidecar on 9820:

```sh
python tools/dev/smokes/aster_ui_page_read_smoke.py --cdp-port 9717 --server-port 9820 --target-timeout 20
```

The successful hardened rerun used CDP port 9053, sidecar port 9924 and extension port 9391. The runner was `./tools/dev/linux/run.sh --new` with `BROWSEROS_USE_MOCK_LLM=false` and the local AppImage wrapper. Python compilation and `git diff --check` passed; Ruff was unavailable. The runner exited successfully, and its processes and ports were closed. The temporary provider was deleted, the previous default provider (`null`) was restored, and the synthetic tab was removed. The generated profile at `/tmp/aster-browser-ui-read/aster-browser/dev/browseros-dev-3199340488` was verified as a non-symlink child of the task-specific temporary directory and removed afterward; other task caches remain there.

**Limitations:** the model is deterministic fixture code, so semantic comprehension and live-provider behavior are untested. This smoke does not test linked Aster/native Chromium, real credentials, approval UI, or network egress enforcement. Keep A01 PARTIAL.
