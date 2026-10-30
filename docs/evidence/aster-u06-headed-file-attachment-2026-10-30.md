# U06 headed file attachment smoke — 2026-10-30

## Result

The disposable headed BrowserOS run passed the composer journey: stage a synthetic text file, remove it, stage it again, and submit. CDP `DOM.setFileInputFiles` supplied the fixture to the real page input, so this does not verify the native file chooser dialog itself. The smoke checked the extension's outgoing `/chat` body, then confirmed that the local sidecar's OpenAI-compatible model request contained the decoded synthetic file marker and returned the fixture provider's response. It verified the marker and filename were absent from both the current page URL and captured chat request URL.

## Harness and runtime

- Harness: `packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke.py`
- Runtime: BrowserOS v0.51.0 AppImage through `tools/dev/linux/run.sh --new`, a fresh temporary profile, and the real Bun sidecar.
- `BROWSEROS_USE_MOCK_LLM=false`; the smoke starts an ephemeral OpenAI-compatible fixture provider bound to `127.0.0.1` and configures BrowserOS to use it. The provider records only its received synthetic request, returns a deterministic SSE completion, and is shut down with the harness. A dummy credential is accepted only by this loopback fixture; no external model or real credential is used.
- Browser egress was restricted using a task-owned AppImage wrapper with Chromium host resolver rules mapping external names to `~NOTFOUND` while allowing loopback. This is host-resolver restriction, not a kernel network namespace.
- The generated fixture was synthetic and stored in a temporary directory. The temporary provider record is deleted in `finally` and any pre-existing default provider is restored; the disposable profile is separate from the user's normal profile. Post-run inspection found no `aster-file-smoke-*` provider and no remaining default in the fresh profile.
- Final headed run used CDP port `9335` and sidecar port `9528`. Its exact result was:

```json
{"browseros_file_attach_remove_submit":"passed","request_body_file_marker":"observed","local_provider_file_marker":"observed","local_provider_response":"received","page_and_chat_url_leak":"none","synthetic_fixture":"aster-file-receipt-5ff8135f.txt"}
```

## Evidence boundary

This proves the headed BrowserOS UI attachment/removal path, extension request serialization, sidecar forwarding, and receipt of the selected content by a local OpenAI-compatible model endpoint. The deterministic endpoint returns a canned answer; it does not establish semantic interpretation by a real model. A ChatService regression also verifies transcript retention and omission of old file payloads on later turns. Failed-stream retry behavior, the native chooser dialog, and native Aster acceptance remain open. U06 remains PARTIAL.

## Reproduction

From `packages/browseros-agent`, start the disposable runner with mock LLM mode disabled and the local-only BrowserOS wrapper, then use the CDP and server ports printed by the runner:

```sh
ASTER_BROWSER_BIN=/tmp/aster-browseros-local-only \
  XDG_CACHE_HOME=/tmp/aster-browser-dev-t133-xld7 \
  BROWSEROS_USE_MOCK_LLM=false ./tools/dev/linux/run.sh --new
python tools/dev/smokes/aster_file_attachment_smoke.py --cdp-port <CDP_PORT> --server-port <SERVER_PORT>
```

Successful output includes `browseros_file_attach_remove_submit: passed`, `request_body_file_marker: observed`, `local_provider_file_marker: observed`, `local_provider_response: received`, and `page_and_chat_url_leak: none`.
