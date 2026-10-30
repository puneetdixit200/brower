# U06 headed file attachment smoke — 2026-10-30

## Result

The disposable headed BrowserOS run passed two composer journeys: the existing home `@` file picker followed by a text-only second turn, and the persistent NewTabChat composer at extension hash route `#/home/chat`. In both routes, the smoke staged, removed, and reattached the synthetic text file. NewTabChat staging and removal caused no `/chat` request or local-provider request; after explicit Send, the unique third fixture response appeared and the selected file marker appeared exactly once in both the NewTabChat `/chat` attachment and local model request. The original two-turn checks remain intact: turn one's marker reaches `/chat` and the provider, while turn two's follow-up reaches the provider without the old marker or filename in the second `/chat` URL/body or model request. CDP `DOM.setFileInputFiles` supplied the fixture to each real page input, so neither journey exercised a physical pointer selection or the native file chooser dialog.

## Harness and runtime

- Harness: `packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke.py`
- Runtime: BrowserOS v0.51.0 AppImage through `tools/dev/linux/run.sh --new`, a fresh temporary profile, and the real Bun sidecar.
- `BROWSEROS_USE_MOCK_LLM=false`; the smoke starts an ephemeral OpenAI-compatible fixture provider bound to `127.0.0.1` and configures BrowserOS to use it. The provider records only its received synthetic request, returns a deterministic SSE completion, and is shut down with the harness. A dummy credential is accepted only by this loopback fixture; no external model or real credential is used.
- Browser egress was restricted using a task-owned AppImage wrapper with Chromium host resolver rules mapping external names to `~NOTFOUND` while allowing loopback. This is host-resolver restriction, not a kernel network namespace.
- The generated fixture was synthetic and stored in a temporary directory. The temporary provider record is deleted in `finally` and any pre-existing default provider is restored; the disposable profile is separate from the user's normal profile and was removed after capture.
- Final headed rerun with the settled no-submit assertions used CDP port `9644` and sidecar port `9984`, with the disposable profile under `/tmp/aster-browser-dev-u06-final-newtab/aster-browser/dev/browseros-dev-1543351059`. The runner was stopped after capture. Its exact result was:

```json
{"browseros_file_attach_remove_submit": "passed", "request_body_file_marker": "observed", "local_provider_file_marker": "observed", "local_provider_response": "turn_one_received", "turn_two_prior_file_marker": "absent_from_chat_and_model_request", "turn_two_local_provider_response": "received", "page_and_chat_url_leak": "none", "newtab_chat_attach_remove_explicit_submit": "passed", "newtab_chat_marker_in_chat_and_provider": "observed", "synthetic_fixture": "aster-file-receipt-b4014788.txt"}
```

## Evidence boundary

This proves headed BrowserOS attachment staging/removal and explicit submission through both the home `@` picker and persistent NewTabChat composer, extension `/chat` serialization, sidecar forwarding, and receipt of the selected content by a local OpenAI-compatible model endpoint. The NewTabChat marker count is exactly one in its `/chat` attachment and provider request; the smoke waits after initial staging, removal and reattachment and confirms those actions alone submit nothing, then observes exactly one `/chat` request after Send. The captured second home `/chat` URL/body and provider request include the follow-up prompt and exclude the prior turn's file marker and filename. The deterministic endpoint returns canned answers; it does not establish semantic interpretation by a real model. CDP supplies files directly to page inputs, so the physical file chooser and pointer interaction remain untested. Mid-stream interruption behavior and native Aster acceptance also remain open. This is BrowserOS smoke evidence, not Aster native acceptance. U06 remains PARTIAL.

## Reproduction

From `packages/browseros-agent`, start the disposable runner with mock LLM mode disabled and the local-only BrowserOS wrapper, then use the CDP and server ports printed by the runner:

```sh
PATH=/home/puneet/.local/bin:/home/puneet/.local/opt/go/bin:$PATH \
  ASTER_BROWSER_BIN=/tmp/aster-browseros-local-only \
  XDG_CACHE_HOME=/tmp/aster-browser-dev-u06-final-newtab \
  BROWSEROS_USE_MOCK_LLM=false ./tools/dev/linux/run.sh --new
python tools/dev/smokes/aster_file_attachment_smoke.py --cdp-port <CDP_PORT> --server-port <SERVER_PORT>
```

Successful output also includes `turn_two_prior_file_marker: absent_from_chat_and_model_request`, `turn_two_local_provider_response: received`, `newtab_chat_attach_remove_explicit_submit: passed`, and `newtab_chat_marker_in_chat_and_provider: observed`. The captured run's temporary runner was stopped after capture.
