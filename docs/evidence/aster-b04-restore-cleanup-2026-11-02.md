# B04 tab restore and cleanup investigation — 2026-11-02

## Runtime and source

- Checkout: `/home/puneet/Projects/aster-browser/upstream-browseros`, branch `feat/aster-linux-ui`, starting HEAD `c0abb822cd9c3896c72ee34363ebc4b518fe2ff7`.
- BrowserOS v0.51.0 AppImage; Chromium `155.0.8309.26`, revision `16c3e55476d3564bea713314b2fff638749ce3e6`.
- Development extension: `oifdmombnijnaiocijiacjhajbnpdlhb`.
- Fresh cache/profile: `/tmp/aster-b04-20261102-run/aster-browser/dev/browseros-dev-upstream-browseros-f2a70ff5`; CDP port `9005`. Chromium sandbox remained enabled.

Chromium source at `/home/puneet/Projects/aster-browser/chromium-aster-dev/src/chrome/browser/extensions/api/sessions/sessions_api.cc` builds recently closed tab objects from the stored session ID, URL, title, index, pin state and active state. It does not populate `tabs.Tab.windowId` for a closed tab. The adjacent API test `sessions_apitest.cc` explicitly expects `windowId == 0` for tabs inside serialized sessions. `sessions.json` defines `lastModified` as the close/modify timestamp in epoch seconds. This is Chromium serialization behavior; zero is not a current-window sentinel.

## Headed observation

Command:

```bash
cd /home/puneet/Projects/aster-browser/upstream-browseros/packages/browseros-agent
python tools/dev/smokes/aster_browser_tabs_ui_smoke.py --cdp-port 9005
```

The visible UI journey passed fixture creation, quick-control selection and activation for both tabs, sidebar order change and switching, page link navigation, Back, Forward, Reload, Pin, Unpin and Close. The smoke failed at Restore because the API returned no usable exact-window identity. In the recorded run:

```json
{
  "current_window": {"id": 868098139, "incognito": false},
  "removed": {"tabId": 868098164, "windowId": 868098139, "at": 1793573504715},
  "recent_session": {
    "sessionId": "868098166",
    "lastModified": 1793573504,
    "windowId": 0,
    "incognito": false,
    "url": "http://127.0.0.1:42965/a?run=785ddfa5fe",
    "title": "Aster Tabs Fixture A 785ddfa5fe"
  }
}
```

The session ID differed from the live tab ID, and the Sessions API exposed no owning window ID. The session list may also contain entries from older closes. `sessions.onChanged` and `tabs.onRemoved` were observed around close; `onRemoved` included the real window ID. Those separate events do not provide a supported mapping from the closed tab ID to a specific session ID. URL/title or timing alone cannot safely establish that mapping, so no closure-receipt workaround was added. The existing exact-window guard remains fail-closed; private-window restores remain unavailable.

The final smoke result was **failed / restore explicitly unsupported by available identity evidence**, not passed. It completed the visible UI journey through Close, clicked Restore, observed the fail-closed message and reported `restore unsupported: Sessions API entries for the closed tab lack a verified current-window ID`. Its `finally` cleanup used visible sidebar close controls and then read all tabs across windows, filtering by this run's unique server port and token. Cleanup independently passed with `remaining_fixture_tabs: []`. A separate read-only query after the run found no tabs at `127.0.0.1:42965`. This does not claim that the restore action succeeded.

## Checks and review

- Focused selector tests: 12 passed, 0 failed. Coverage includes same-window, other-window, zero/invalid/missing window IDs, missing session ID, duplicate session IDs, window sessions, incognito and unknown privacy state.
- App typecheck: passed.
- Python syntax compilation: passed.
- Targeted Biome: passed after formatting.
- `git diff --check`: passed.
- Independent Luna medium review: no actionable findings. Runtime behavior and actual multiwindow/private-window negative smoke cases were not covered by that review.
- The supported account-allowance meter was not exposed in this session; no percentage was inferred.

Identical-URL candidate behavior, closure-receipt expiry/replay (no receipt implementation was warranted), and a window disappearing during the lookup/restore interval were not exercised. A true two-normal-window and private-window headed negative smoke remains required when a runtime provides a restorable session with trustworthy ownership metadata.

## Remaining gates

B04 remains **PARTIAL**. The full headed smoke did not pass because this fixture's native Sessions data cannot identify the original owning window. There is no secure UI workaround based on the available APIs, so Restore remains unavailable for these entries. Actual two-window/private-window headed negative tests, native Aster acceptance, and session restore in a runtime exposing reliable window identity remain open. The BrowserOS fixture result is not native Aster acceptance.
