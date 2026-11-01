#!/usr/bin/env python3
"""Exercise Aster display customization in a disposable headed BrowserOS profile.

The caller owns BrowserOS startup and cleanup. This smoke uses the actual
customization controls and a loopback CDP endpoint; no external pages or data
are accessed.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tests/e2e"))
from aster_ui_latency_benchmark import CDP  # noqa: E402

ASTER_ID = "oifdmombnijnaiocijiacjhajbnpdlhb"
# WXT's logical `local:theme` item is stored as `theme` in chrome.storage.local.
DISPLAY_KEY = "aster.display.settings.v1"
WAIT_SECONDS = 15.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, required=True)
    args = parser.parse_args()

    base = f"http://127.0.0.1:{args.cdp_port}"
    with urllib.request.urlopen(f"{base}/json/list", timeout=5) as response:
        targets = json.load(response)
    extension_pages = [
        item
        for item in targets
        if item.get("type") == "page"
        and item.get("url", "").startswith(f"chrome-extension://{ASTER_ID}/")
        and item.get("webSocketDebuggerUrl")
    ]
    target = next(
        (item for item in extension_pages if "#/settings/customization" in item.get("url", "")),
        next(
            (item for item in extension_pages if "/app.html" in item.get("url", "")),
            extension_pages[0] if extension_pages else None,
        ),
    )
    if not target:
        raise RuntimeError("No open Aster app page found in the caller-owned disposable profile")

    class OrdinaryPageHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = (
                "<!doctype html><meta charset=utf-8><title>Ordinary page fixture</title>"
                "<style>html{font-size:23px;transition-duration:2s}"
                "body{color:rgb(1, 2, 3)}</style><body>ordinary page</body>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    ordinary_page_server = ThreadingHTTPServer(("127.0.0.1", 0), OrdinaryPageHandler)
    Thread(target=ordinary_page_server.serve_forever, daemon=True).start()
    ordinary_page_url = f"http://127.0.0.1:{ordinary_page_server.server_port}/ordinary"
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
        ensure_customization_route(cdp)
        wait_for(cdp, "document.querySelector('button[aria-label=\"Aster theme\"]')")
        wait_for(cdp, "document.querySelector('button[aria-label=\"Aster interface scale\"]')")
        wait_for(cdp, "document.querySelector('#aster-reduced-motion')")

        select_theme(cdp, "Light")
        wait_for(cdp, "document.documentElement.classList.contains('light')")
        wait_for_stored_theme(cdp, "light")
        assert_theme(cdp, "light")
        select_theme(cdp, "Dark")
        wait_for(cdp, "document.documentElement.classList.contains('dark')")
        wait_for_stored_theme(cdp, "dark")
        assert_theme(cdp, "dark")
        checks["explicit_light_dark_selection"] = "passed"

        select_scale(cdp, "90%")
        wait_for_display_settings(cdp, {"scale": 90, "reducedMotion": False})
        wait_for(cdp, "getComputedStyle(document.documentElement).fontSize==='14.4px'")
        select_scale(cdp, "100%")
        wait_for_display_settings(cdp, {"scale": 100, "reducedMotion": False})
        wait_for(cdp, "getComputedStyle(document.documentElement).fontSize==='16px'")
        select_scale(cdp, "110%")
        wait_for_display_settings(cdp, {"scale": 110, "reducedMotion": False})
        wait_for(cdp, "getComputedStyle(document.documentElement).fontSize==='17.6px'")
        checks["interface_scale_90_100_110"] = "passed"

        toggle_reduced_motion(cdp, True)
        wait_for_display_settings(cdp, {"scale": 110, "reducedMotion": True})
        wait_for(cdp, "document.documentElement.dataset.asterReducedMotion==='true'")
        wait_for(
            cdp,
            "getComputedStyle(document.querySelector('#aster-reduced-motion')).transitionDuration==='1e-05s' || "
            "getComputedStyle(document.querySelector('#aster-reduced-motion')).transitionDuration==='0.00001s'",
        )
        toggle_reduced_motion(cdp, False)
        wait_for_display_settings(cdp, {"scale": 110, "reducedMotion": False})
        wait_for(cdp, "!document.documentElement.dataset.asterReducedMotion")
        checks["reduced_motion_control_and_scoped_style"] = "passed"

        # Exercise Radix Select's keyboard path and assert focus stays on the control.
        select_theme(cdp, "System")
        keyboard_select_theme(cdp, "Light")
        wait_for(cdp, "document.documentElement.classList.contains('light')")
        wait_for_stored_theme(cdp, "light")
        checks["keyboard_selection_and_focus"] = "passed"
        select_theme(cdp, "System")
        emulate_scheme(cdp, "light")
        wait_for(cdp, "document.documentElement.classList.contains('light')")
        emulate_scheme(cdp, "dark")
        wait_for(cdp, "document.documentElement.classList.contains('dark')")
        wait_for_stored_theme(cdp, "system")
        assert_theme(cdp, "system")
        wait_for_display_settings(cdp, {"scale": 110, "reducedMotion": False})
        wait_for(cdp, "getComputedStyle(document.documentElement).fontSize==='17.6px'")
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
        wait_for_display_settings(cdp, {"scale": 110, "reducedMotion": False})
        wait_for(cdp, "getComputedStyle(document.documentElement).fontSize==='17.6px'")
        wait_for(cdp, "!document.documentElement.dataset.asterReducedMotion")
        checks["system_preference_persists_after_extension_page_reload"] = "passed"
        checks["full_browser_process_restart"] = "not exercised; caller-owned runtime"

        assert_ordinary_page_isolation(base, ordinary_page_url, checks)

        print(
            json.dumps(
                {"scope": "disposable headed BrowserOS profile", "checks": checks},
                indent=2,
            )
        )
        return 0
    finally:
        cdp.ws.close()
        ordinary_page_server.shutdown()
        ordinary_page_server.server_close()


def emulate_scheme(cdp: CDP, scheme: str) -> None:
    cdp.call(
        "Emulation.setEmulatedMedia",
        {
            "media": "screen",
            "features": [{"name": "prefers-color-scheme", "value": scheme}],
        },
    )


def ensure_customization_route(cdp: CDP) -> None:
    """Reach display controls through the app's visible settings navigation."""
    theme_trigger = "document.querySelector('button[aria-label=\"Aster theme\"]')"
    if cdp.evaluate(f"!!({theme_trigger})"):
        return

    settings_link = (
        "[...document.querySelectorAll('a')].find(link=>"
        "link.innerText.trim()==='Settings' && link.getClientRects().length)"
    )
    if cdp.evaluate(f"!!({settings_link})"):
        click_element(cdp, settings_link)
        wait_for(cdp, "location.hash.includes('/settings/')")

    customization_link = (
        "[...document.querySelectorAll('a')].find(link=>"
        "link.innerText.trim()==='Customize Aster' && link.getClientRects().length)"
    )
    if not cdp.evaluate(f"!!({customization_link})"):
        # The settings layout moves its navigation into a mobile sheet at the
        # headed runner's narrow viewport. Open it through the visible menu.
        settings_menu = "document.querySelector('header button:has(svg.lucide-menu)')"
        if cdp.evaluate(f"!!({settings_menu})"):
            wait_for(
                cdp,
                "(()=>{const e="
                + settings_menu
                + ";if(!e)return false;e.scrollIntoView({block:'center',inline:'center'});"
                "const r=e.getBoundingClientRect(),hit=document.elementFromPoint("
                "r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===e||e.contains(hit))})()",
            )
            click_element(cdp, settings_menu)
            wait_for(
                cdp,
                "(()=>{const overlay=document.querySelector('[data-slot=sheet-overlay]');"
                "const content=document.querySelector('[data-slot=sheet-content]');"
                "return overlay?.dataset.state==='open'&&content?.dataset.state==='open'&&"
                "content.getAnimations().every(animation=>animation.playState==='finished')})()",
            )
    wait_for(cdp, f"!!({customization_link})")
    click_element(cdp, customization_link)
    wait_for(cdp, "location.hash.endsWith('/settings/customization')")
    wait_for(cdp, f"!!({theme_trigger})")
    wait_for(
        cdp,
        "(()=>{const overlay=document.querySelector('[data-slot=sheet-overlay]');"
        "return !overlay||(overlay.dataset.state==='closed'&&"
        "getComputedStyle(overlay).pointerEvents==='none')})()",
    )


def select_theme(cdp: CDP, label: str) -> None:
    trigger = "document.querySelector('button[aria-label=\"Aster theme\"]')"
    if not cdp.evaluate(f"{trigger}?.getAttribute('aria-expanded')==='true'"):
        click_element(cdp, trigger)
    wait_for_option(cdp, label)
    click_element(
        cdp,
        "[...document.querySelectorAll('[role=option]')].find(item=>item.innerText.trim()==="
        + json.dumps(label)
        + " && item.getClientRects().length)",
    )
    wait_for(
        cdp,
        "document.querySelector('button[aria-label=\"Aster theme\"]')?.innerText.trim()==="
        + json.dumps(label),
    )
    wait_for(cdp, "!document.querySelector('[data-slot=select-content]')")


def select_scale(cdp: CDP, label: str) -> None:
    trigger = "document.querySelector('button[aria-label=\"Aster interface scale\"]')"
    wait_for(cdp, f"{trigger} && !{trigger}.disabled")
    if cdp.evaluate(f"{trigger}.getAttribute('aria-expanded')!=='true'"):
        click_element(cdp, trigger)
    wait_for_option(cdp, label)
    click_element(
        cdp,
        "[...document.querySelectorAll('[role=option]')].find(item=>item.innerText.trim()==="
        + json.dumps(label)
        + " && item.getClientRects().length)",
    )
    wait_for(
        cdp,
        "document.querySelector('button[aria-label=\"Aster interface scale\"]')?.innerText.trim()==="
        + json.dumps(label),
    )
    wait_for(cdp, "!document.querySelector('[data-slot=select-content]')")


def toggle_reduced_motion(cdp: CDP, enabled: bool) -> None:
    wait_for(cdp, "!document.querySelector('#aster-reduced-motion')?.disabled")
    current = bool(
        cdp.evaluate(
            "document.querySelector('#aster-reduced-motion')?.getAttribute('aria-checked')==='true'"
        )
    )
    if current != enabled:
        click_element(cdp, "document.querySelector('#aster-reduced-motion')")
    wait_for(
        cdp,
        "document.querySelector('#aster-reduced-motion')?.getAttribute('aria-checked')==="
        + json.dumps(str(enabled).lower()),
    )


def keyboard_select_theme(cdp: CDP, label: str) -> None:
    trigger = "document.querySelector('button[aria-label=\"Aster theme\"]')"
    if cdp.evaluate(f"{trigger}?.getAttribute('aria-expanded')!=='true'"):
        click_element(cdp, trigger)
    wait_for_option(cdp, label)
    for event_type in ("keyDown", "keyUp"):
        cdp.call(
            "Input.dispatchKeyEvent",
            {
                "type": event_type,
                "key": "ArrowDown",
                "code": "ArrowDown",
                "windowsVirtualKeyCode": 40,
            },
        )
    wait_for(
        cdp,
        "[...document.querySelectorAll('[role=option]')].some(item=>"
        "item.innerText.trim()==="
        + json.dumps(label)
        + " && item.hasAttribute('data-highlighted'))",
    )
    for event_type in ("keyDown", "keyUp"):
        cdp.call(
            "Input.dispatchKeyEvent",
            {
                "type": event_type,
                "key": "Enter",
                "code": "Enter",
                "windowsVirtualKeyCode": 13,
            },
        )
    wait_for(
        cdp,
        "document.querySelector('button[aria-label=\"Aster theme\"]')?.innerText.trim()==="
        + json.dumps(label),
    )
    wait_for(
        cdp,
        "document.activeElement===document.querySelector('button[aria-label=\"Aster theme\"]')",
    )
    focused = cdp.evaluate("document.activeElement?.getAttribute('aria-label')")
    if focused != "Aster theme":
        raise AssertionError(f"Theme control lost focus after keyboard selection: {focused!r}")
    has_visible_focus = cdp.evaluate(
        "(()=>{const e=document.activeElement;const s=getComputedStyle(e);"
        "return e.matches(':focus-visible')&&(s.boxShadow!=='none'||"
        "(s.outlineStyle!=='none'&&s.outlineWidth!=='0px'))})()"
    )
    if not has_visible_focus:
        raise AssertionError("Keyboard-selected theme control has no visible focus indicator")


def wait_for_option(cdp: CDP, label: str) -> None:
    wait_for(
        cdp,
        "[...document.querySelectorAll('[role=option]')].some(item=>item.innerText.trim()==="
        + json.dumps(label)
        + " && item.getClientRects().length)",
    )


def wait_for_display_settings(cdp: CDP, expected: dict[str, object]) -> None:
    wait_for(
        cdp,
        "chrome.storage.local.get(" + json.dumps(DISPLAY_KEY) + ").then(value=>JSON.stringify(value["
        + json.dumps(DISPLAY_KEY)
        + "])===" + json.dumps(json.dumps(expected, separators=(",", ":"))) + ")",
    )


def assert_ordinary_page_isolation(
    base: str, page_url: str, checks: dict[str, str]
) -> None:
    request = urllib.request.Request(
        f"{base}/json/new?{urllib.parse.quote(page_url, safe='')}",
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        target = json.load(response)
    page_cdp = CDP(target["webSocketDebuggerUrl"])
    try:
        page_cdp.call("Runtime.enable")
        wait_for(page_cdp, "document.body?.innerText==='ordinary page'")
        actual = page_cdp.evaluate(
            "({fontSize:getComputedStyle(document.documentElement).fontSize,"
            "transition:getComputedStyle(document.documentElement).transitionDuration,"
            "reducedMotion:document.documentElement.dataset.asterReducedMotion||null})"
        )
        if actual != {"fontSize": "23px", "transition": "2s", "reducedMotion": None}:
            raise AssertionError(f"Ordinary webpage styles were affected: {actual!r}")
        checks["ordinary_webpage_style_isolation"] = "passed"
    finally:
        page_cdp.ws.close()
        with urllib.request.urlopen(f"{base}/json/close/{target['id']}", timeout=5):
            pass


def click_element(cdp: CDP, element_expression: str) -> None:
    bounds = cdp.evaluate(
        "(() => { const element="
        + element_expression
        + "; if(!element) return null; element.scrollIntoView({block:'center',inline:'center'});"
        "const rect=element.getBoundingClientRect();"
        "const style=getComputedStyle(element);"
        "if(!rect.width||!rect.height||style.display==='none'||style.visibility==='hidden'||"
        "style.pointerEvents==='none'||element.disabled)return null;"
        "const x=rect.x+rect.width/2,y=rect.y+rect.height/2,hit=document.elementFromPoint(x,y);"
        "return {x,y,receivesPointer:!!hit&&(hit===element||element.contains(hit)),"
        "hit:hit?.outerHTML.slice(0,180)??null}; })()"
    )
    if not bounds:
        raise RuntimeError(f"Could not find visible UI control: {element_expression}")
    if not bounds["receivesPointer"]:
        raise RuntimeError(
            "Visible UI control is occluded at its click point: "
            f"{element_expression}; hit={bounds['hit']}"
        )
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
        # Read Chrome's backing key, not WXT's `local:` namespace prefix.
        "chrome.storage.local.get('theme').then(value=>value.theme==="
        + json.dumps(theme)
        + ")",
    )


def assert_theme(cdp: CDP, expected: str) -> None:
    stored = cdp.evaluate("chrome.storage.local.get('theme').then(value=>value.theme)")
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
