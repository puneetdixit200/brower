#!/usr/bin/env python3
"""Exercise visible BrowserOS tab controls in an already-running dev session.

Attach only: this script never launches a browser or builds the app. Fixture
tabs are opened and closed through the visible UI. Chrome tabs/windows APIs are
used only to observe IDs, URLs, order, pin/active state, and window membership.
Run only against a disposable, non-private BrowserOS dev session.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))
from aster_ui_latency_benchmark import CDP  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--target-timeout", type=float, default=15)
    args = parser.parse_args()

    token = uuid.uuid4().hex[:10]
    first_title = f"Aster Tabs Fixture A {token}"
    second_title = f"Aster Tabs Fixture B {token}"

    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            is_second = self.path.split("?", 1)[0] == "/b"
            title = second_title if is_second else first_title
            link = f"/b?run={token}" if not is_second else f"/a-from-b?run={token}"
            body = (
                "<!doctype html><meta charset=utf-8><title>" + title +
                "</title><main><h1>" + title + "</h1><a id=next href=" +
                json.dumps(link) + ">Next fixture page</a></main>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    url_a, url_b = f"{base}/a?run={token}", f"{base}/b?run={token}"
    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    cdp: CDP | None = None
    browser_cdp: CDP | None = None
    app_target_id: str | None = None
    evidence: dict[str, object] = {}
    result: dict[str, object] | None = None
    cleanup_error: str | None = None
    try:
        target = wait_target(cdp_base, args.target_timeout)
        app_target_id = target["id"]
        with urllib.request.urlopen(f"{cdp_base}/json/version", timeout=5) as response:
            version = json.load(response)
        browser_cdp = CDP(version["webSocketDebuggerUrl"])
        cdp = CDP(target["webSocketDebuggerUrl"])
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        activate_page(browser_cdp, app_target_id)
        cdp.evaluate("location.hash='#/home'")
        wait_js(cdp, "!!document.querySelector('[aria-label=\"Open URL or search in new tab\"]')")
        close_sidebar(cdp)
        dismiss_import_hint(cdp)

        window = cdp.evaluate("chrome.windows.getCurrent().then(w=>({id:w.id,incognito:w.incognito}))")
        if not window or window.get("incognito"):
            raise RuntimeError("expected an attached non-private disposable BrowserOS window")
        evidence["current_window_id"] = window["id"]
        evidence["private_window"] = False

        # Open both local fixture pages using the visible address form.
        for url in (url_a, url_b):
            focus_address_input(cdp)
            key(cdp, "CTRL", "a")
            cdp.call("Input.insertText", {"text": url})
            wait_js(cdp, f'document.querySelector("input[aria-label=\\\"Open URL or search in new tab\\\"]")?.value==={json.dumps(url)}')
            click(cdp, 'button[type="submit"]')
            wait_js(cdp, f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.some(t=>t.url==={json.dumps(url)}))")
            # The visible Open action selects the new webpage tab. Bring the
            # app page forward as test-harness focus so the next visible UI
            # interaction remains on its real controls.
            activate_page(browser_cdp, app_target_id)

        tabs = current_fixture_tabs(cdp, base)
        if len(tabs) != 2:
            raise AssertionError(f"expected two fixture tabs in current window; observed {tabs}")
        if any(tab.get("windowId") != window["id"] for tab in tabs):
            raise AssertionError(f"fixture tabs escaped current window {window['id']}: {tabs}")
        evidence["fixture_tabs_observed"] = tabs
        id_a = next(int(t["id"]) for t in tabs if t.get("url") == url_a)
        id_b = next(int(t["id"]) for t in tabs if t.get("url") == url_b)

        # Select and activate both pages through BrowserQuickControls, verifying
        # the visible selector tracks the live current-window tab IDs.
        click_text(cdp, "Refresh tabs")
        for fixture_id in (id_a, id_b):
            live = current_fixture_tabs(cdp, base)
            if not any(
                tab.get("id") == fixture_id and tab.get("windowId") == window["id"]
                for tab in live
            ):
                raise AssertionError(
                    f"fixture tab {fixture_id} is no longer in current window {window['id']}: {live}"
                )
            select_web_tab(cdp, fixture_id)
            selected_id = int(
                cdp.evaluate(
                    "Number(document.querySelector('select[aria-label=\"Choose a website tab for browser actions\"]').value)"
                )
            )
            if selected_id != fixture_id:
                raise AssertionError(
                    f"quick controls selected {selected_id}, expected fixture tab {fixture_id}"
                )
            click(cdp, 'button[aria-label="Activate selected tab"]')
            wait_js(
                cdp,
                f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.some(t=>t.id==={fixture_id}&&t.active&&t.windowId==={window['id']}))",
            )
        activate_page(browser_cdp, app_target_id)
        evidence["quick_controls_select_activate"] = [id_a, id_b]

        # Reorder while the sidebar still has the fixture's original titles.
        ensure_tabs_section(cdp)
        wait_js(cdp, f"!!document.querySelector('button[aria-label={json.dumps('Move ' + second_title + ' earlier')}]')")
        click(cdp, f'button[aria-label="Move {second_title} earlier"]')
        wait_js(cdp, f"chrome.tabs.query({{currentWindow:true}}).then(ts=>{{const a=ts.find(t=>t.id==={id_a}),b=ts.find(t=>t.id==={id_b});return a&&b&&b.index<a.index}})")
        order = cdp.evaluate(f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.filter(t=>[{id_a},{id_b}].includes(t.id)).map(t=>({{id:t.id,index:t.index}})))")
        evidence["reorder_observed"] = order

        click(cdp, f'button[title={json.dumps(url_a)}]')
        wait_js(cdp, f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.some(t=>t.id==={id_a}&&t.active))")
        wait_js(cdp, f"[...document.querySelectorAll('button[aria-current=page]')].some(b=>b.title==={json.dumps(url_a)})")
        activate_page(browser_cdp, app_target_id)
        # The mobile sidebar closes after navigation; reopen it before selecting
        # the other page through the same visible control.
        ensure_tabs_section(cdp)
        wait_js(
            cdp,
            f"!!document.querySelector('button[title={json.dumps(url_b)}]')",
        )
        click(cdp, f'button[title={json.dumps(url_b)}]')
        wait_js(cdp, f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.some(t=>t.id==={id_b}&&t.active))")
        wait_js(cdp, f"[...document.querySelectorAll('button[aria-current=page]')].some(b=>b.title==={json.dumps(url_b)})")
        activate_page(browser_cdp, app_target_id)
        evidence["tab_switch"] = {"first_tab_id": id_a, "second_tab_id": id_b, "sidebar_selection_followed": True}

        # Visible page link, then Browser actions Back / Forward / Reload.
        page_target = wait_target(cdp_base, args.target_timeout, url_b=url_b)
        page = CDP(page_target["webSocketDebuggerUrl"])
        try:
            page.call("Runtime.enable")
            if browser_cdp is not None:
                activate_page(browser_cdp, page_target["id"])
            click(page, "a#next")
            wait_js(page, f"location.pathname==='/a-from-b' && document.title==={json.dumps(first_title)}")
        finally:
            page.ws.close()
        activate_page(browser_cdp, app_target_id)
        close_sidebar(cdp)
        select_web_tab(cdp, id_b)
        click(cdp, 'button[aria-label="Back selected webpage"]')
        wait_js(cdp, f"chrome.tabs.get({id_b}).then(t=>t.url==={json.dumps(url_b)})")
        click(cdp, 'button[aria-label="Forward selected webpage"]')
        wait_js(cdp, f"chrome.tabs.get({id_b}).then(t=>t.url.includes('/a-from-b?run={token}'))")
        click(cdp, 'button[aria-label="Reload selected webpage"]')
        wait_js(cdp, f"chrome.tabs.get({id_b}).then(t=>t.title==={json.dumps(first_title)})")
        evidence["navigation"] = ["visible page link", "Back", "Forward", "Reload"]

        # Sidebar selection, reorder, pin/unpin, close and restore.
        ensure_tabs_section(cdp)

        # Pin causes Chromium to move a tab into the pinned region; unpin through its visible button.
        fixture_row = f'li:has(button[title={json.dumps(url_a)}])'
        wait_js(cdp, f"!!document.querySelector({json.dumps(fixture_row + ' button[aria-label=\"Pin tab\"]')})")
        click(cdp, f'{fixture_row} button[aria-label="Pin tab"]')
        wait_js(cdp, f"chrome.tabs.get({id_a}).then(t=>t.pinned)")
        wait_js(cdp, f"!!document.querySelector({json.dumps(fixture_row + ' button[aria-label=\"Unpin tab\"]')})")
        click(cdp, f'{fixture_row} button[aria-label="Unpin tab"]')
        wait_js(cdp, f"chrome.tabs.get({id_a}).then(t=>!t.pinned)")
        wait_js(cdp, f"!!document.querySelector({json.dumps(fixture_row + ' button[aria-label=\"Pin tab\"]')})")
        evidence["pin_unpin"] = True

        # Close via the sidebar and restore via Browser actions; restored ID may differ.
        click(cdp, f'{fixture_row} button[aria-label="Close tab"]')
        wait_js(cdp, f"chrome.tabs.get({id_a}).then(()=>false).catch(()=>true)")
        close_sidebar(cdp)
        click(cdp, 'button[aria-label="Reopen closed tab"]')
        wait_js(cdp, f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.some(t=>t.url==={json.dumps(url_a)}&&t.windowId==={window['id']}))")
        activate_page(browser_cdp, app_target_id)
        restored = next(t for t in current_fixture_tabs(cdp, base) if t.get("url") == url_a)
        evidence["close_restore"] = {"closed_id": id_a, "restored_id": restored["id"]}

        # The extension app tab is active again for observation and is intentionally
        # omitted from the webpage-only sidebar list. No webpage row should be
        # marked active while the extension's own tab is the current active tab.
        click_text(cdp, "Refresh tabs")
        activate_page(browser_cdp, app_target_id)
        ensure_tabs_section(cdp)
        wait_js(cdp, "chrome.tabs.query({currentWindow:true}).then(ts=>{const t=ts.find(x=>x.active);return !!t&&t.url.startsWith('chrome-extension://')&&[...document.querySelectorAll('button[aria-current=page]')].length===0})")
        active_state = cdp.evaluate("chrome.tabs.query({currentWindow:true}).then(ts=>{const t=ts.find(x=>x.active);return t?{id:t.id,url:t.url}:null})")
        sidebar_active = cdp.evaluate("[...document.querySelectorAll('button[aria-current=page]')].map(b=>b.title)")
        if not active_state or not active_state["url"].startswith("chrome-extension://") or sidebar_active:
            raise AssertionError(f"active browser tab and sidebar selection disagree: active={active_state}, sidebar={sidebar_active}")
        evidence["active_tab_id"] = active_state["id"]
        evidence["sidebar_active_titles"] = sidebar_active
        evidence["stop_identity_gate"] = "Stop control was not invoked; native Aster identity gate preserved"
        evidence["chrome_api_scope"] = "read-only tabs/windows inspection; no tab-mutating API calls"
        evidence["limitations"] = ["No Aster-native control claim", "No claim about other windows or private-window behavior"]
        result = {"result": "passed", "fixture_base": base, **evidence}
    finally:
        if cdp:
            # Clean only this run's fixture pages, by clicking their visible
            # sidebar close controls. Do not close unrelated tabs or call tabs.remove.
            try:
                if browser_cdp is not None and app_target_id is not None:
                    activate_page(browser_cdp, app_target_id)
                if cdp.evaluate("!document.querySelector('input[aria-label=\"Search tabs\"]')"):
                    ensure_tabs_section(cdp)
                for _ in range(4):
                    owned = current_fixture_tabs(cdp, base)
                    if not owned:
                        break
                    close_selector = (
                        f'li:has(button[title={json.dumps(owned[0].get("url", ""))}]) '
                        'button[aria-label="Close tab"]'
                    )
                    wait_js(cdp, f"!!document.querySelector({json.dumps(close_selector)})")
                    click(cdp, close_selector)
                    wait_tab_gone(cdp, int(owned[0]["id"]), timeout=3)
            except Exception as error:
                cleanup_error = str(error)
            cdp.ws.close()
        if browser_cdp:
            browser_cdp.ws.close()
        server.shutdown()
        server.server_close()
    if cleanup_error:
        raise RuntimeError(f"fixture cleanup failed: {cleanup_error}")
    if result is None:
        raise RuntimeError("tab smoke ended without a result")
    result["cleanup"] = "passed"
    print(json.dumps(result, indent=2))
    return 0


def wait_target(base: str, timeout: float, url_b: str | None = None) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/json/list", timeout=2) as response:
                targets = json.load(response)
            target = next((t for t in targets if t.get("type") == "page" and (url_b in t.get("url", "") if url_b else t.get("url", "").startswith("chrome-extension://") and "#/home" in t.get("url", ""))), None)
            if target:
                return target
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError("required BrowserOS CDP page target did not appear")


def activate_page(browser_cdp: CDP, target_id: str | None) -> None:
    if target_id is None:
        raise RuntimeError("cannot activate a missing CDP target id")
    browser_cdp.call("Target.activateTarget", {"targetId": target_id})


def wait_js(cdp: CDP, expression: str, timeout: float = 20) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression):
                return
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError(f"UI/state condition timed out: {expression}")


def current_fixture_tabs(cdp: CDP, base: str) -> list[dict]:
    return cdp.evaluate(f"chrome.tabs.query({{currentWindow:true}}).then(ts=>ts.filter(t=>t.url?.startsWith({json.dumps(base)})).map(t=>({{id:t.id,url:t.url,title:t.title,windowId:t.windowId,index:t.index,active:t.active,pinned:t.pinned}})))")


def click(cdp: CDP, selector: str, optional: bool = False) -> None:
    point = cdp.evaluate(
        "(()=>{const e=document.querySelector(" + json.dumps(selector) + ");"
        "if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});"
        "const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;"
        "const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);"
        "return {x,y,receivesPointer:!!hit&&(hit===e||e.contains(hit)),"
        "hit:hit?.outerHTML.slice(0,180)}})()"
    )
    if point is None:
        if optional:
            return
        raise RuntimeError(f"visible UI control not found: {selector}")
    if not point["receivesPointer"]:
        raise RuntimeError(
            f"visible UI control is occluded at its click point: {selector}; "
            f"hit={point['hit']}"
        )
    for kind, button in (("mousePressed", "left"), ("mouseReleased", "left")):
        cdp.call("Input.dispatchMouseEvent", {"type": kind, "x": point["x"], "y": point["y"], "button": button, "clickCount": 1})


def click_text(cdp: CDP, text: str) -> None:
    point = cdp.evaluate(
        "(()=>{const e=[...document.querySelectorAll('button')].find(button=>button.innerText.trim()==="
        + json.dumps(text)
        + ");if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});"
        "const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;"
        "return {x:r.left+r.width/2,y:r.top+r.height/2}})()"
    )
    if point is None:
        raise RuntimeError(f"visible UI button with text {text!r} not found")
    for kind in ("mousePressed", "mouseReleased"):
        cdp.call("Input.dispatchMouseEvent", {"type": kind, "x": point["x"], "y": point["y"], "button": "left", "clickCount": 1})


def ensure_sidebar_open(cdp: CDP) -> None:
    if not cdp.evaluate("document.querySelector('[data-slot=sheet-overlay]')?.dataset.state==='open'"):
        click(cdp, 'button[aria-label="Open navigation"]')
    # Radix marks the sheet open as soon as it starts its 500 ms slide-in.
    # Wait for the animated content to settle before sending a coordinate click.
    wait_js(
        cdp,
        "(()=>{const overlay=document.querySelector('[data-slot=sheet-overlay]');"
        "const content=document.querySelector('[data-slot=sheet-content]');"
        "return overlay?.dataset.state==='open'&&content?.dataset.state==='open'&&"
        "content.getAnimations().every(animation=>animation.playState==='finished')"
        "})()",
    )


def ensure_tabs_section(cdp: CDP) -> None:
    ensure_sidebar_open(cdp)
    if not cdp.evaluate("!!document.querySelector('input[aria-label=\"Search tabs\"]')?.getClientRects().length"):
        click(cdp, 'button[aria-label="Tabs"]')
    wait_js(cdp, "!!document.querySelector('input[aria-label=\"Search tabs\"]')?.getClientRects().length")


def close_sidebar(cdp: CDP) -> None:
    close = cdp.evaluate("document.querySelector('[data-slot=sheet-overlay]')?.dataset.state==='open'")
    if close:
        click(cdp, '[data-slot="sheet-content"] button:has(span.sr-only)')
    wait_js(cdp, "(()=>{const e=document.querySelector('[data-slot=sheet-overlay]');return !e||(e.dataset.state==='closed'&&getComputedStyle(e).pointerEvents==='none')})()")


def focus_address_input(cdp: CDP) -> None:
    selector = 'input[aria-label="Open URL or search in new tab"]'
    for _ in range(3):
        click(cdp, selector)
        if cdp.evaluate(f"document.activeElement===document.querySelector({json.dumps(selector)})"):
            return
        time.sleep(0.2)
    details = cdp.evaluate(
        "(()=>{const e=document.querySelector(" + json.dumps(selector) + ");"
        "const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);"
        "return JSON.stringify({active:document.activeElement.outerHTML.slice(0,180),"
        "target:e.outerHTML.slice(0,180),hit:top?.outerHTML.slice(0,180),"
        "rect:r.toJSON(),focused:document.hasFocus()})})()"
    )
    raise RuntimeError(f"Could not focus visible address field: {details}")


def select_web_tab(cdp: CDP, tab_id: int) -> None:
    selector = 'select[aria-label="Choose a website tab for browser actions"]'
    state = cdp.evaluate(
        f"(()=>{{const s=document.querySelector({json.dumps(selector)});"
        f"return {{current:s.selectedIndex,target:[...s.options].findIndex(o=>Number(o.value)==={tab_id})}}}})()"
    )
    if state["target"] < 0:
        raise AssertionError(f"website tab {tab_id} is missing from the visible selector")
    click(cdp, selector)
    delta = state["target"] - state["current"]
    for _ in range(abs(delta)):
        key_press(cdp, "ArrowDown" if delta > 0 else "ArrowUp")
    key_press(cdp, "Enter")
    wait_js(cdp, f"document.querySelector({json.dumps(selector)})?.value==={json.dumps(str(tab_id))}")


def dismiss_import_hint(cdp: CDP) -> None:
    title = "[...document.querySelectorAll('*')].find(node=>node.childElementCount===0&&node.textContent.trim()==='Import your data')"
    try:
        wait_js(cdp, f"!!{title}", timeout=3)
    except TimeoutError:
        return
    point = cdp.evaluate(
        f"(()=>{{const title={title};const button=title?.closest('.fixed')?.querySelector('button');"
        "if(!button)return null;const r=button.getBoundingClientRect();"
        "return {x:r.left+r.width/2,y:r.top+r.height/2}})()"
    )
    if point is None:
        return
    for event_type in ("mousePressed", "mouseReleased"):
        cdp.call(
            "Input.dispatchMouseEvent",
            {"type": event_type, "x": point["x"], "y": point["y"], "button": "left", "clickCount": 1},
        )
    wait_js(cdp, f"!{title}")


def key(cdp: CDP, modifier: str, value: str) -> None:
    if modifier == "CTRL":
        cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Control", "code": "ControlLeft", "windowsVirtualKeyCode": 17})
        if value.lower() != "a":
            raise ValueError("unsupported control chord")
        cdp.call("Input.dispatchKeyEvent", {"type": "keyDown", "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2})
        cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Control", "code": "ControlLeft", "windowsVirtualKeyCode": 17})
    elif value == "ENTER":
        key_press(cdp, "Enter")
    else:
        raise ValueError(f"unsupported key: {modifier} {value}")


def key_press(cdp: CDP, value: str) -> None:
    codes = {"Enter": ("Enter", 13), "ArrowDown": ("ArrowDown", 40), "ArrowUp": ("ArrowUp", 38)}
    if value not in codes:
        raise ValueError(f"unsupported key: {value}")
    code, virtual = codes[value]
    for event in ("keyDown", "keyUp"):
        cdp.call("Input.dispatchKeyEvent", {"type": event, "key": value, "code": code, "windowsVirtualKeyCode": virtual})


def wait_tab_gone(cdp: CDP, tab_id: int, timeout: float) -> None:
    try:
        wait_js(cdp, f"chrome.tabs.get({tab_id}).then(()=>false).catch(()=>true)", timeout)
    except TimeoutError:
        raise RuntimeError(f"fixture tab {tab_id} remains open after visible cleanup")


if __name__ == "__main__":
    raise SystemExit(main())
