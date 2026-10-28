# P03 Chromium Actor Login API review — 2026-10-28

## Result

P03 remains unimplemented. The pinned Chromium checkout has a native Actor Login credential service that can retrieve credentials, fill through Chromium's password manager, enforce permission state, and report when device reauthentication is required. It does not expose a standalone browser-owned credential chooser/consent operation to DevTools. The existing chooser is reached through the Actor task's `ToolDelegate` and task delegate UI. Calling the service directly from the DevTools handler would therefore either expose credential metadata to the DevTools caller or bypass the user-selection/consent step. Neither is an acceptable integration.

The Aster `approval_unavailable` denial for `Autofill.list`, `Autofill.add`, and `Autofill.fill` must remain until the browser UI and broker described below are connected and tested. No native source was modified in this review.

## Source evidence

The pinned source reviewed was `/home/puneet/Projects/aster-browser/chromium-aster-dev/src`.

- `components/password_manager/core/browser/actor_login/actor_login_service.h:23-52` exposes asynchronous `GetCredentials(client, ...)` and `AttemptLogin(client, credential, should_store_permission, ...)`. Its credential callback returns a vector of full `Credential` objects, and its login API requires a concrete selected credential plus an explicit persistent-permission boolean. There is no selection or consent callback in this interface.
- `chrome/browser/actor/tools/attempt_login_tool.cc:222-227,230-259` calls `GetCredentials`, handles existing persistent permission, and prepares the results. `:343-347` delegates selection to `tool_delegate().PromptToSelectCredential(...)`.
- `chrome/browser/actor/tools/attempt_login_tool.cc:357-417` validates the selected credential ID against the browser-held result vector and consumes the permission duration from the selection response. `:431-455` stores the selection in task state and checks that the main-frame token has not changed while the user was selecting; `:459-470` invokes native login only after those checks.
- `chrome/browser/actor/execution_engine.cc:1732-1747` routes that chooser through the active Actor task delegate's `RequestToShowCredentialSelectionDialog`. This UI path is coupled to Actor task infrastructure and is not callable from the current Aster DevTools handler.
- `components/password_manager/core/browser/actor_login/internal/actor_login_delegate_impl.cc:172-188` rejects concurrent requests and a disabled feature. `:196-245` binds filling to the client's current main-frame origin and invokes Chromium's `ActorLoginCredentialFiller` for password credentials. `LoginStatusResult` in `actor_login_types.h:146-160` includes invalid-credential and no-fillable-fields results; later enum entries include device reauthentication required/failed and page-changed-during-filling.
- `actor_login_types.h:97-115` carries the native request origin and whether a persistent permission exists, but also carries the username and source site for presentation. Returning the raw credential vector from DevTools would disclose metadata across the protocol boundary even though the password is not directly returned.

These APIs provide useful trusted internals for a future broker. They do not prove that the generic Actor chooser, its consent model, or its permissions are appropriate for Aster's agent-initiated flow. Persistent Actor Login grants are broader than a one-operation approval, so they must not be silently inherited by Aster.

## Safe implementation plan

1. Add a browser-owned Aster credential broker beside the DevTools Autofill handler. It must be constructed from the target's live `WebContents`, `Profile`, primary main-frame `GlobalRenderFrameHostToken`, committed `url::Origin`, and a fresh operation ID. Reject non-HTTP(S), opaque origins, off-the-record contexts, missing/detached targets, and stale documents.
2. Keep `GetCredentials` results entirely in native browser memory. Present a browser-owned modal/bubble that identifies the exact requesting origin and lets the user select a saved credential or cancel. The confirmation must be a fresh user gesture; an agent, page, DevTools request, or extension message cannot synthesize it. Do not return usernames, credential IDs, or permission state through DevTools.
3. After selection, re-check the target, document token, origin, operation ID, and visible/focused tab. Invoke the native fill path only for the selected credential. Default approval to this operation only. Do not grant Chromium's persistent Actor Login permission unless Aster adds a separately reviewed, explicit persistent-consent UI and revocation surface.
4. Require native device reauthentication for the path where Chromium reports it, and surface that as a browser-owned action. Cancel on navigation, tab close, target detach, timeout, cancellation, or any mismatch; clear selected credential material and complete the protocol operation once.
5. Return only a coarse completion result (filled / cancelled / reauth required / rejected / failed). Never place credential fields, usernames, IDs, passwords, or page-extracted field values in model context, DevTools responses, logs, task history, analytics, or errors.
6. Add browser tests with synthetic credentials for same-origin binding, page navigation during chooser, target detach, cancellation, private profiles, missing user gesture, repeated operation IDs, reauthentication, no credential metadata in protocol output, and unchanged legacy BrowserOS behavior. Build the focused native DevTools and Actor Login targets, then run a disposable-profile browser smoke before changing the guard.

## Current state

- Aster DevTools `list`, `add`, and `fill` remain denied with `approval_unavailable`.
- This review did not modify the native checkout or read credentials. Since the review, the exact Aster guard/test hunks have been applied to the native checkout and Aster Debug GN regeneration succeeded. Native compilation and browser testing remain pending; native build work is ongoing.
- Source review supports a future broker built atop native Actor Login internals, but the browser-owned Aster selection/consent and DevTools integration remain required work. This source review does not change P03's NOT_STARTED status.

The guard remains a denial boundary only. Keep P03 NOT_STARTED until the browser-owned broker and consent flow described above are implemented, reviewed, compiled and exercised in a browser. No completion count is asserted for the ongoing native build.
