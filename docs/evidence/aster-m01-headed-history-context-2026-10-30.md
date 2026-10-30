# M01 headed history context receipt — 2026-10-30

## Result

The disposable headed BrowserOS run seeded two local history pages, searched both through the Home composer’s actual History picker, selected only one result, and submitted through the real composer. The local fixture provider received the selected title and selected HTTP origin exactly once. It did not receive the unselected title or either page’s distinct path, query, or fragment marker. The current extension route and `/chat` request URL contained no selected/unselected title, origin, path, query, or fragment value. The provider returned its deterministic response and the combined U06 attachment, later-turn exclusion, and NewTabChat checks also passed.

Exact smoke output:

```json
{"browseros_file_attach_remove_submit": "passed", "request_body_file_marker": "observed", "local_provider_file_marker": "observed", "local_provider_response": "turn_one_received", "selected_history_provider_receipt": "selected_title_and_origin_once", "unselected_history_and_full_urls": "absent_from_provider_and_route_url", "selected_history_title": "ASTER_HISTORY_SYNTHETIC_6d5836754ef74ac29e3d1d6aae2ad36a_SELECTED_TITLE", "selected_history_origin": "http://127.0.0.1:42317", "unselected_history_title": "ASTER_HISTORY_SYNTHETIC_6d5836754ef74ac29e3d1d6aae2ad36a_UNSELECTED_TITLE", "turn_two_prior_file_marker": "absent_from_chat_and_model_request", "turn_two_local_provider_response": "received", "page_and_chat_url_leak": "none", "newtab_chat_attach_remove_explicit_submit": "passed", "newtab_chat_marker_in_chat_and_provider": "observed", "synthetic_fixture": "aster-file-receipt-54e3e4f7.txt"}
```

## Runtime and method

- Harness: `packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke.py`.
- BrowserOS v0.51.0 AppImage, Linux dev runner, fresh disposable profile `/tmp/aster-browser-dev-m01-headed/aster-browser/dev/browseros-dev-1757830418`.
- Final run ports: CDP `9030`, sidecar `9898`, extension `9427`; the local history fixture used origin `http://127.0.0.1:42317`.
- The two history pages were served only from loopback and carried UUID-suffixed titles and distinct synthetic path/query/fragment markers. A new temporary browser target visited each page so the browser’s actual history API could supply them to the picker. CDP DOM interaction opened the visible picker, searched the common unique prefix, verified both titles were present, and clicked only the selected row’s “Add to request” control.
- The first Home send also carried the existing synthetic text attachment to route through the smoke’s local OpenAI-compatible fixture provider. That provider recorded the actual model request and returned a canned SSE response. No external model or real credential was used; the BrowserOS AppImage wrapper blocks external hostname resolution while allowing loopback.
- After the run, the runner and sidecar stopped, the exact disposable profile was removed, and no runner process remained. The source checkout’s adjacent dirty Chromium tree was not touched.

## Verification and limits

- `python -m py_compile packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke.py` passed.
- `python packages/browseros-agent/tools/dev/smokes/aster_file_attachment_smoke_test.py` passed 6/6 smoke cleanup tests, including failure-safe temporary-tab closure and complete teardown attempts after provider cleanup errors.
- `git diff --check` passed after documentation updates.
- This proves headed BrowserOS History API → real Home picker → composer → `/chat` → local provider receipt and exact selection/origin/path filtering for this fixture. The deterministic fixture does not interpret the history semantically. The smoke used CDP DOM actions rather than physical pointer input. It is not native Aster acceptance, so M01 remains PARTIAL pending native runtime and semantic real-model evidence.
