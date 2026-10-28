#!/usr/bin/env python3
"""Exercise Aster theme selection in a disposable headed BrowserOS profile.

The caller owns BrowserOS startup and cleanup. This smoke uses the real theme
selector and CDP color-scheme emulation; it does not access network or profile
data beyond the theme preference under test.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tests/e2e"))
from aster_ui_latency_benchmark import CDP  # noqa: E402

ASTER_ID = "oifdmombnijnaiocijiacjhajbnpdlhb"
WAIT_SECONDS = 15.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, required=True)
    args = parser.parse_args()

    base = f"http://127.0.0.1:{args.cdp_port}"
    with urllib.request.urlopen(f"{base}/json/list", timeout=5) as response:
        targets = json.load(response)
    target = next(
        (
            item
            for item in targets
            if item.get("type") == "page"
            and item.get("url", "").startswith(f"chrome-extension://{ASTER_ID}/")
            and "#/settings/customization" in item.get("url", "")
        ),
        None,
    )
    if not target:
        raise RuntimeError("Open Aster Settings > Customization in the disposable profile")

    cdp = CDP(target["webSocketDebuggerUrl"])
    checks: dict[str, str] = {}
    try:
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        wait_for(
            cdp,
            "typeof chrome!=='undefined' && chrome.runtime?.id==="
            + json.dumps(ASTER_ID),
        )

        select_theme(cdp, "Light")
        wait_for(cdp, "document.documentElement.classList.contains('light')")
        wait_for_stored_theme(cdp, "light")
        assert_theme(cdp, "light")
        select_theme(cdp, "Dark")
        wait_for(cdp, "document.documentElement.classList.contains('dark')")
        wait_for_stored_theme(cdp, "dark")
        assert_theme(cdp, "dark")
        checks["explicit_light_dark_selection"] = "passed"

        select_theme(cdp, "System")
        emulate_scheme(cdp, "light")
        wait_for(cdp, "document.documentElement.classList.contains('light')")
        emulate_scheme(cdp, "dark")
        wait_for(cdp, "document.documentElement.classList.contains('dark')")
        wait_for_stored_theme(cdp, "system")
        assert_theme(cdp, "system")
        checks["system_follows_light_and_dark_preference_changes"] = "passed"

        # This attach-only smoke cannot own a BrowserOS process restart.
        cdp.call("Page.reload", {"ignoreCache": True})
        wait_for(
            cdp,
            "typeof chrome!=='undefined' && chrome.runtime?.id==="
            + json.dumps(ASTER_ID)
            + " && document.querySelector('button[aria-label=\"Aster theme\"]')?.innerText.trim()==='System'",
        )
        wait_for(cdp, "document.documentElement.classList.contains('dark')")
        wait_for_stored_theme(cdp, "system")
        assert_theme(cdp, "system")
        checks["system_preference_persists_after_extension_page_reload"] = "passed"
        checks["full_browser_process_restart"] = "not exercised; caller-owned runtime"

        print(
            json.dumps(
                {"scope": "disposable headed BrowserOS profile", "checks": checks},
                indent=2,
            )
        )
        return 0
    finally:
        cdp.ws.close()


def emulate_scheme(cdp: CDP, scheme: str) -> None:
    cdp.call(
        "Emulation.setEmulatedMedia",
        {
            "media": "screen",
            "features": [{"name": "prefers-color-scheme", "value": scheme}],
        },
    )


def select_theme(cdp: CDP, label: str) -> None:
    click_element(cdp, "document.querySelector('button[aria-label=\"Aster theme\"]')")
    wait_for(cdp, "document.querySelector('[role=option]')")
    click_element(
        cdp,
        "[...document.querySelectorAll('[role=option]')].find(item=>item.innerText.trim()==="
        + json.dumps(label)
        + ")",
    )
    wait_for(
        cdp,
        "document.querySelector('button[aria-label=\"Aster theme\"]')?.innerText.trim()==="
        + json.dumps(label),
    )


def click_element(cdp: CDP, element_expression: str) -> None:
    bounds = cdp.evaluate(
        "(() => { const element="
        + element_expression
        + "; if(!element) return null; const rect=element.getBoundingClientRect();"
        "return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()"
    )
    if not bounds:
        raise RuntimeError(f"Could not find visible theme control: {element_expression}")
    for event_type, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
        cdp.call(
            "Input.dispatchMouseEvent",
            {
                "type": event_type,
                "x": bounds["x"],
                "y": bounds["y"],
                "button": "left",
                "buttons": buttons,
                "clickCount": 1,
            },
        )


def wait_for_stored_theme(cdp: CDP, theme: str) -> None:
    wait_for(
        cdp,
        "chrome.storage.local.get('local:theme').then(value=>value['local:theme']==="
        + json.dumps(theme)
        + ")",
    )


def assert_theme(cdp: CDP, expected: str) -> None:
    stored = cdp.evaluate(
        "chrome.storage.local.get('local:theme').then(value=>value['local:theme'])"
    )
    if stored != expected:
        raise AssertionError(f"Expected stored theme {expected!r}, got {stored!r}")


def wait_for(cdp: CDP, expression: str, timeout: float = WAIT_SECONDS) -> None:
    deadline = time.monotonic() + timeout
    condition = f"!!({expression})"
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(condition):
                return
        except RuntimeError:
            # Navigation can briefly destroy the extension page's JS context.
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for UI condition: {expression}")


if __name__ == "__main__":
    raise SystemExit(main())
