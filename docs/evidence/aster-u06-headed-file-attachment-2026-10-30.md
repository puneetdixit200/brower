# U06 headed file attachment smoke — 2026-10-30

## Result

The disposable headed BrowserOS run passed the composer journey: stage a synthetic text file, remove it, stage it again, and submit it on turn one. CDP `DOM.setFileInputFiles` supplied the fixture to the real page input, so this does not verify the native file chooser dialog itself. The smoke checked that turn one's extension `/chat` body and the local sidecar's OpenAI-compatible model request contained the decoded synthetic file marker. It then submitted a text-only follow-up on turn two and verified the follow-up prompt reached the second model request while the turn-one marker and filename were absent from the second `/chat` URL and body and from the second model request. The fixture returned separate canned responses for both turns. The marker and filename were also absent from the page URL and first `/chat` URL.

## Harness and runtime

- Harness: `packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke.py`
- Runtime: BrowserOS v0.51.0 AppImage through `tools/dev/linux/run.sh --new`, a fresh temporary profile, and the real Bun sidecar.
- `BROWSEROS_USE_MOCK_LLM=false`; the smoke starts an ephemeral OpenAI-compatible fixture provider bound to `127.0.0.1` and configures BrowserOS to use it. The provider records only its received synthetic request, returns a deterministic SSE completion, and is shut down with the harness. A dummy credential is accepted only by this loopback fixture; no external model or real credential is used.
- Browser egress was restricted using a task-owned AppImage wrapper with Chromium host resolver rules mapping external names to `~NOTFOUND` while allowing loopback. This is host-resolver restriction, not a kernel network namespace.
- The generated fixture was synthetic and stored in a temporary directory. The temporary provider record is deleted in `finally` and any pre-existing default provider is restored; the disposable profile is separate from the user's normal profile. Post-run inspection found no `aster-file-smoke-*` provider and no remaining default in the fresh profile.
- Final lead rerun used CDP port `9130` and sidecar port `9485`, with the disposable profile under `/tmp/aster-browser-dev-u06-final/aster-browser/dev/browseros-dev-1743567782`. Its exact result was:

```json
{"browseros_file_attach_remove_submit": "passed", "request_body_file_marker": "observed", "local_provider_file_marker": "observed", "local_provider_response": "turn_one_received", "turn_two_prior_file_marker": "absent_from_chat_and_model_request", "turn_two_local_provider_response": "received", "page_and_chat_url_leak": "none", "synthetic_fixture": "aster-file-receipt-bf2b6d17.txt"}
```

## Evidence boundary

This proves the headed BrowserOS UI attachment/removal path, extension request serialization, sidecar forwarding, and receipt of the selected content by a local OpenAI-compatible model endpoint. The captured second `/chat` URL/body and model request include the follow-up prompt and exclude the prior turn's file marker and filename. The deterministic endpoint returns canned answers; it does not establish semantic interpretation by a real model. Mid-stream interruption behavior, the native chooser dialog, and native Aster acceptance remain open. This is BrowserOS smoke evidence, not Aster native acceptance. U06 remains PARTIAL.

## Reproduction

From `packages/browseros-agent`, start the disposable runner with mock LLM mode disabled and the local-only BrowserOS wrapper, then use the CDP and server ports printed by the runner:

```sh
PATH=/home/puneet/.local/bin:/home/puneet/.local/opt/go/bin:$PATH \
  ASTER_BROWSER_BIN=/tmp/aster-browseros-local-only \
  XDG_CACHE_HOME=/tmp/aster-browser-dev-u06-final \
  BROWSEROS_USE_MOCK_LLM=false ./tools/dev/linux/run.sh --new
python tools/dev/smokes/aster_file_attachment_smoke.py --cdp-port <CDP_PORT> --server-port <SERVER_PORT>
```

Successful output also includes `turn_two_prior_file_marker: absent_from_chat_and_model_request` and `turn_two_local_provider_response: received`. The temporary runner/profile/cache used above were stopped and removed after capture.
