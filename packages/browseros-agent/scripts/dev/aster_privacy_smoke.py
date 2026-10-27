#!/usr/bin/env python3
"""Exercise Aster optional diagnostics consent in a disposable headed browser.

The caller must start BrowserOS with an explicit disposable BROWSEROS_DIR, a
fresh profile, and the test server in a dedicated loopback namespace. This
script never starts or stops a browser/server and never reads global state or
user profile data. The caller owns process setup and cleanup.

The script reads and prints only consent booleans and HTTP statuses. It never
prints tokens or raw response payloads. By default it runs the interaction
smoke and leaves consent off. --leave-enabled is for an operator who will
restart the sidecar themselves; --expect-enabled/--expect-disabled validate
consent after that restart without changing it.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tests" / "e2e"))

from aster_ui_latency_benchmark import CDP  # noqa: E402

ASTER_ID = "oifdmombnijnaiocijiacjhajbnpdlhb"
SWITCH_SELECTOR = '[role="switch"][aria-label="Allow optional app and agent diagnostics"]'
WAIT_SECONDS = 20.0


def get_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


def wait_for(predicate, label: str, timeout: float = WAIT_SECONDS) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # Navigation and CDP can briefly race.
            last_error = error
        time.sleep(0.2)
    raise TimeoutError(f"Timed out waiting for {label}") from last_error


def targets(cdp_base: str) -> list[dict[str, Any]]:
    return get_json(f"{cdp_base}/json/list")


def privacy_target(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    prefix = f"chrome-extension://{ASTER_ID}/"
    return next(
        (
            item
            for item in items
            if item.get("type") == "page" and item.get("url", "").startswith(prefix)
        ),
        None,
    )


def read_state(cdp: CDP) -> dict[str, Any] | None:
    return cdp.evaluate(
        "(()=>{const s=document.querySelector(" + json.dumps(SWITCH_SELECTOR) + ");"
        "if(!s)return null;const alert=document.querySelector('[role=alert]');"
        "return {on:s.getAttribute('aria-checked')==='true',disabled:s.disabled,"
        "alert:alert?.textContent||'',retry:[...document.querySelectorAll('button')]"
        ".some(b=>b.textContent.includes('Retry loading consent')),"
        "incognito:document.body.innerText.includes('App error reporting is disabled in incognito')}})()"
    )


def expect_state(cdp: CDP, enabled: bool) -> dict[str, Any]:
    value = wait_for(
        lambda: (state := read_state(cdp))
        and state["on"] is enabled
        and not state["disabled"]
        and state,
        f"consent switch enabled={enabled}",
    )
    return value


def navigate_privacy(cdp: CDP, app_url: str) -> None:
    # Chrome may briefly expose chrome-error:// after extension startup; retry
    # explicit navigation a bounded number of times and require the real DOM.
    for _attempt in range(4):
        cdp.call("Page.navigate", {"url": app_url})
        try:
            wait_for(
                lambda: cdp.evaluate(
                    "typeof chrome!=='undefined' && chrome.runtime?.id==="
                    + json.dumps(ASTER_ID)
                    + " && location.hash==='#/settings/privacy' && !!document.querySelector("
                    + json.dumps(SWITCH_SELECTOR)
                    + ")"
                ),
                "rendered privacy settings DOM",
                timeout=8,
            )
            return
        except TimeoutError:
            continue
    raise TimeoutError("Aster privacy page did not render after explicit navigation retries")


def click_switch(cdp: CDP) -> None:
    cdp.evaluate(
        "document.querySelector(" + json.dumps(SWITCH_SELECTOR) + ").click()"
    )


def server_enabled(server_base: str) -> bool:
    # The endpoint's JSON is consumed locally and only the boolean is retained.
    request = urllib.request.Request(
        f"{server_base}/privacy/telemetry/state", method="POST"
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        value = json.load(response)
    if not isinstance(value, dict) or not isinstance(value.get("enabled"), bool):
        raise RuntimeError("Consent state endpoint returned an unexpected shape")
    return value["enabled"]


def set_server_enabled(server_base: str, enabled: bool) -> None:
    body = json.dumps({"enabled": enabled}).encode()
    request = urllib.request.Request(
        f"{server_base}/privacy/telemetry",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError("Consent fixture reset failed")


def run_smoke(cdp_base: str, server_base: str, output: str | None, leave_enabled: bool) -> dict[str, bool]:
    items = targets(cdp_base)
    target = privacy_target(items)
    if target is None:
        raise RuntimeError("Aster extension page was not found in the headed browser")

    app_url = f"chrome-extension://{ASTER_ID}/app.html#/settings/privacy"
    first = CDP(target["webSocketDebuggerUrl"])
    second: CDP | None = None
    second_id: str | None = None
    blocked = False
    checks: dict[str, bool] = {}
    try:
        first.call("Runtime.enable")
        first.call("Page.enable")
        first.call("Network.enable")
        navigate_privacy(first, app_url)

        # Start each run from a known off state in the disposable namespace.
        set_server_enabled(server_base, False)
        navigate_privacy(first, app_url)
        expect_state(first, False)
        click_switch(first)
        expect_state(first, True)
        if not server_enabled(server_base):
            raise AssertionError("Grant did not enable server consent")
        checks["grant_updates_server"] = True

        second_id = first.call("Target.createTarget", {"url": app_url})["targetId"]
        second_target = wait_for(
            lambda: next((item for item in targets(cdp_base) if item.get("id") == second_id), None),
            "second consent tab",
        )
        second = CDP(second_target["webSocketDebuggerUrl"])
        second.call("Runtime.enable")
        second.call("Page.enable")
        wait_for(lambda: read_state(second), "second privacy DOM")
        expect_state(second, True)
        checks["grant_syncs_across_tabs"] = True

        first.call("Network.setBlockedURLs", {"urls": [f"{server_base}/privacy/telemetry"]})
        blocked = True
        click_switch(first)
        wait_for(lambda: (state := read_state(first)) and state["alert"], "failed revoke alert")
        expect_state(second, True)
        checks["failed_revoke_keeps_peer_truthful"] = server_enabled(server_base) is True and read_state(second)["on"] is True

        first.call("Network.setBlockedURLs", {"urls": [f"{server_base}/*"]})
        try:
            first.call("Page.reload")
        except Exception:
            # Reload may race the navigation failure; DOM retry below remains
            # the assertion and is bounded.
            pass
        wait_for(
            lambda: (state := read_state(first)) and state["alert"] and state["retry"],
            "offline retry error",
        )
        offline_state = read_state(first)
        checks["offline_has_retry"] = bool(offline_state["retry"])
        checks["ordinary_window_not_mislabeled_incognito"] = not offline_state["incognito"]

        first.call("Network.setBlockedURLs", {"urls": []})
        blocked = False
        first.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Retry loading consent')).click()"
        )
        expect_state(first, True)
        checks["retry_recovers_saved_choice"] = not bool(read_state(first)["alert"])

        click_switch(second)
        expect_state(second, False)
        expect_state(first, False)
        checks["confirmed_revoke_syncs_and_updates_server"] = server_enabled(server_base) is False

        if leave_enabled:
            click_switch(first)
            expect_state(first, True)
            checks["enabled_for_operator_restart"] = server_enabled(server_base) is True
        else:
            checks["final_consent_off"] = server_enabled(server_base) is False

        if output:
            Path(output).write_text(
                json.dumps({"scope": "disposable headed BrowserOS profile", "checks": checks}, indent=2) + "\n",
                encoding="utf-8",
            )
        return checks
    finally:
        if blocked:
            try:
                first.call("Network.setBlockedURLs", {"urls": []})
            except Exception:
                pass
        # Default behavior restores consent off after failures as well. The
        # caller can opt into an enabled state for an operator-managed restart.
        if not leave_enabled:
            try:
                if server_enabled(server_base):
                    set_server_enabled(server_base, False)
                    first.call("Page.reload")
                    expect_state(first, False)
            except Exception:
                try:
                    state = read_state(first)
                    if state and state["on"] and not state["disabled"]:
                        click_switch(first)
                except Exception:
                    pass
        if second_id:
            try:
                first.call("Target.closeTarget", {"targetId": second_id})
            except Exception:
                pass
        if second:
            second.ws.close()
        first.ws.close()


def verify_expected(cdp_base: str, server_base: str, expected: bool) -> dict[str, bool]:
    target = privacy_target(targets(cdp_base))
    if target is None:
        raise RuntimeError("Aster extension page was not found in the headed browser")
    cdp = CDP(target["webSocketDebuggerUrl"])
    try:
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        app_url = f"chrome-extension://{ASTER_ID}/app.html#/settings/privacy"
        navigate_privacy(cdp, app_url)
        state = expect_state(cdp, expected)
        canonical = server_enabled(server_base)
        if canonical is not expected:
            raise AssertionError("UI consent does not match the server's persisted consent")
        return {"ui_matches_expected": state["on"] is expected, "server_matches_expected": canonical is expected}
    finally:
        cdp.ws.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-port", type=int, default=9483)
    parser.add_argument("--server-port", type=int, default=9079)
    parser.add_argument("--output", help="Optional path for a JSON summary containing booleans only")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--expect-enabled", action="store_true", help="Validate persisted enabled consent without changing it")
    mode.add_argument("--expect-disabled", action="store_true", help="Validate persisted disabled consent without changing it")
    parser.add_argument("--leave-enabled", action="store_true", help="Leave consent enabled for an operator-managed sidecar restart")
    args = parser.parse_args()
    if args.leave_enabled and (args.expect_enabled or args.expect_disabled):
        parser.error("--leave-enabled applies only to the interaction smoke")

    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    server_base = f"http://127.0.0.1:{args.server_port}"
    if args.expect_enabled or args.expect_disabled:
        checks = verify_expected(cdp_base, server_base, args.expect_enabled)
    else:
        checks = run_smoke(cdp_base, server_base, args.output, args.leave_enabled)
    if not all(checks.values()):
        raise AssertionError(checks)
    if args.output and (args.expect_enabled or args.expect_disabled):
        Path(args.output).write_text(
            json.dumps({"scope": "disposable headed BrowserOS profile", "checks": checks}, indent=2) + "\n",
            encoding="utf-8",
        )
    if not args.output or args.expect_enabled or args.expect_disabled:
        print(json.dumps(checks, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
