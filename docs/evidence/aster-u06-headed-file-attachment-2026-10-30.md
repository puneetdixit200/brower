# U06 headed file attachment smoke — 2026-10-30

## Result

The disposable headed BrowserOS run passed the composer journey: stage a synthetic text file, remove it, stage it again, submit, and receive the deterministic mock chat response. CDP `DOM.setFileInputFiles` supplied the fixture to the real page input, so this does not verify the native file chooser dialog itself. The smoke inspected the extension's outgoing `/chat` request before it left the extension page, decoded the data URL in `attachments[0].data`, and confirmed the unique synthetic marker was present. It also confirmed the marker and filename were absent from both the current page URL and captured chat request URL.

## Harness and runtime

- Harness: `packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke.py`
- Runtime: BrowserOS v0.51.0 AppImage through `tools/dev/linux/run.sh --new`, a fresh temporary profile, and the real Bun sidecar.
- `BROWSEROS_USE_MOCK_LLM=true`; the configured OpenAI-compatible provider used a dummy credential and the local sidecar URL. No external model call or real credential was used.
- Browser egress was restricted using a task-owned AppImage wrapper with Chromium host resolver rules mapping external names to `~NOTFOUND` while allowing loopback. This is host-resolver restriction, not a kernel network namespace.
- The generated fixture was synthetic and stored in a temporary directory. The provider record was deleted by the harness in `finally`; the disposable profile is separate from the user's normal profile.

## Evidence boundary

This proves the headed BrowserOS UI attachment/removal path and that the extension serializes the selected content in the request body to its local sidecar. It does not prove the sidecar forwarded the file to a provider, a model read or interpreted it, retry or persistence semantics, or acceptance on a native Aster binary. U06 remains PARTIAL.

## Reproduction

From `packages/browseros-agent`, start the disposable runner with `BROWSEROS_USE_MOCK_LLM=true`, then run:

```sh
python tools/dev/smokes/aster_file_attachment_smoke.py --cdp-port 9784 --server-port 9821
```

Successful output includes `browseros_file_attach_remove_submit: passed`, `request_body_file_marker: observed`, `mock_chat_response: received`, and `page_and_chat_url_leak: none`.
