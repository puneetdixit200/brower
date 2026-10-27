#!/usr/bin/env python3
"""Verify two local routes in one active tab; background-tab typing is not covered."""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from aster_ui_latency_benchmark import CDP

EVENTS: list[tuple[str, str]] = []


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/done":
            body = "<title>A02 navigation complete</title><h1 id='done'>First page navigated</h1>"
        elif self.path in ("/one", "/two"):
            page = self.path[1:]
            body = (
                f"<title>A02 fixture {page}</title>"
                f"<main><h1>Local page {page}</h1>"
                f"<label>Value <input id='value' aria-label='Value'></label>"
                f"<button id='submit' onclick=\"submitValue('{page}')\">Record value</button>"
                "<p id='result'>Not submitted</p></main>"
                "<script>function submitValue(page){const value=document.querySelector('#value').value;"
                "document.querySelector('#result').textContent='Recorded '+value;"
                "fetch('/result',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},"
                "body:new URLSearchParams({page,value})})}"
                "</script>"
            )
        else:
            self.send_error(404)
            return
        data = f"<!doctype html><html><body>{body}</body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path != "/result":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        values = urllib.parse.parse_qs(self.rfile.read(length).decode())
        page = values.get("page", [""])[0]
        value = values.get("value", [""])[0]
        EVENTS.append((page, value))
        self.send_response(204)
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> int:
    base = "http://127.0.0.1:9005"
    server = ThreadingHTTPServer(("127.0.0.1", 9191), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    cdp: CDP | None = None
    provider_id = f"aster-multipage-smoke-{uuid.uuid4()}"
    provider_saved = False
    fixture_tab_ids: list[int] = []
    try:
        target = wait_for_target(base)
        cdp = CDP(target["webSocketDebuggerUrl"])
        cdp.call("Runtime.enable")
        cdp.evaluate("location.hash='#/home'")
        wait_for(cdp, "location.hash === '#/home'")
        wait_for(
            cdp,
            "[...document.querySelectorAll('button')].some(b=>"
            "/^Tabs\\d+$/.test(b.textContent.trim()))",
        )
        setup = cdp.evaluate(
            "(async ({providerId}) => {"
            "const provider={type:'openai-compatible',name:'Aster Multi-page Fixture Mock',"
            "baseUrl:'http://127.0.0.1:9105/v1',modelId:'aster-test-mock',"
            "supportsImages:false,contextWindow:32000,temperature:0.2,"
            "apiKey:'test-only-dummy',createdAt:Date.now()};"
            "const headers={'Content-Type':'application/json'};"
            "const saved=await fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
            "{method:'PUT',headers,body:JSON.stringify(provider)});"
            "const selected=await fetch('http://127.0.0.1:9105/providers/default',"
            "{method:'PUT',headers,body:JSON.stringify({providerId})});"
            "const first=await chrome.tabs.create({url:'http://127.0.0.1:9191/one',active:true});"
            "return {saved:saved.status,selected:selected.status,ids:[first.id],active:first.active};"
            "})({providerId:" + json.dumps(provider_id) + "})"
        )
        provider_saved = setup["saved"] == 200
        fixture_tab_ids = setup.get("ids", [])
        if setup["saved"] != 200 or setup["selected"] != 200 or setup["active"] is not True:
            raise RuntimeError(f"Could not create mock provider: {setup}")
        if (
            len(fixture_tab_ids) != 1
            or any(not isinstance(tab_id, int) or tab_id <= 0 for tab_id in fixture_tab_ids)
        ):
            raise RuntimeError(f"Could not create one active fixture tab: {fixture_tab_ids}")

        cdp.evaluate("location.reload()")
        wait_for(cdp, "location.hash === '#/home'")
        wait_for(cdp, "document.body.innerText.includes('Aster Multi-page Fixture Mock')")
        attach_fixture_tabs(cdp, fixture_tab_ids)
        set_value(
            cdp,
            "textarea",
            "Fill and submit the local form, navigate this tab to the second local form and submit it, then navigate to the done page.\n"
            f"A02_FIXTURE_TAB_ID={fixture_tab_ids[0]}",
        )
        cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>"
            "b.querySelector('svg.lucide-arrow-right'))?.click()"
        )
        wait_for(cdp, "location.hash.includes('/home/chat')")

        approved = 0
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            state = cdp.evaluate(
                "({approval:[...document.querySelectorAll('button')].some(b=>"
                "b.textContent.trim()==='Approve'),done:document.body.innerText.includes("
                + json.dumps("Mock BrowserOS test response.")
                + ")})"
            )
            if state["approval"]:
                if approved == 2:
                    wait_for(
                        cdp,
                        "chrome.tabs.get(" + str(fixture_tab_ids[0]) + ").then(tab=>"
                        "tab.url==='http://127.0.0.1:9191/two')",
                    )
                cdp.evaluate(
                    "[...document.querySelectorAll('button')].find(b=>"
                    "b.textContent.trim()==='Approve')?.click()"
                )
                approved += 1
                expected_states = {
                    1: lambda: fixture_dom(base, "/one", "#value.value")
                    == "typed on page one",
                    2: lambda: ("one", "typed on page one") in EVENTS,
                    3: lambda: fixture_dom(base, "/two", "#value.value")
                    == "typed on page two",
                    4: lambda: ("two", "typed on page two") in EVENTS,
                }
                if approved in expected_states:
                    wait_for_fixture_state(
                        expected_states[approved],
                        f"fixture state after approved action {approved}",
                        base,
                        cdp,
                    )
            elif state["done"] and len(EVENTS) == 2:
                break
            else:
                time.sleep(0.25)
        if approved != 4:
            raise RuntimeError(f"Expected four approvals for the form edits, got {approved}")
        expected_events = {
            ("one", "typed on page one"),
            ("two", "typed on page two"),
        }
        if sorted(EVENTS) != sorted(expected_events):
            raise RuntimeError(f"The fixture POSTs did not match: {EVENTS}")

        targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=5))
        first_page = next(
            item
            for item in targets
            if item.get("type") == "page"
            and item.get("url") == "http://127.0.0.1:9191/done"
        )
        first_cdp = CDP(first_page["webSocketDebuggerUrl"])
        first_cdp.call("Runtime.enable")
        try:
            navigated = first_cdp.evaluate("document.querySelector('#done')?.textContent")
        finally:
            first_cdp.ws.close()
        if navigated != "First page navigated":
            raise RuntimeError(f"First page did not reach the final route: {navigated!r}")

        print(
            json.dumps(
                {
                    "active_fixture_tab": fixture_tab_ids[0],
                    "form_submissions": EVENTS,
                    "form_posts_observed": bool(EVENTS),
                    "first_page_navigation": navigated,
                    "approved_mutations": approved,
                    "network": "loopback only",
                    "provider_credential": "dummy only",
                },
                indent=2,
            )
        )
        return 0
    finally:
        if cdp is not None:
            try:
                cdp.evaluate(
                    "(async ({providerId,tabIds,providerSaved})=>{"
                    "for(const id of tabIds) await chrome.tabs.remove(id).catch(()=>{});"
                    "if(providerSaved) await fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
                    "{method:'DELETE'}).catch(()=>{});"
                    "})({providerId:"
                    + json.dumps(provider_id)
                    + ",tabIds:"
                    + json.dumps(fixture_tab_ids)
                    + ",providerSaved:"
                    + json.dumps(provider_saved)
                    + "})"
                )
            except Exception:
                pass
            cdp.ws.close()
        server.shutdown()
        server.server_close()


def wait_for_target(base: str) -> dict:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=2))
            target = next(
                (
                    item
                    for item in targets
                    if item.get("type") == "page"
                    and item.get("url", "").startswith("chrome-extension://")
                    and item.get("url", "").partition("#")[0].endswith("/app.html")
                ),
                None,
            )
            if target:
                return target
        except Exception:
            time.sleep(0.5)
    raise TimeoutError("Aster home CDP target did not start")


def wait_for(cdp: CDP, expression: str, timeout: float = 40) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression):
                return
        except Exception:
            pass
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for UI condition: {expression}")


def attach_fixture_tabs(cdp: CDP, tab_ids: list[int]) -> None:
    cdp.evaluate(
        "[...document.querySelectorAll('button')].find(b=>"
        "/^Tabs\\d+$/.test(b.textContent.trim()))?.click()"
    )
    wait_for(cdp, "!!document.querySelector('[aria-label=\"Select tabs\"]')")
    for index, tab_id in enumerate(tab_ids, start=1):
        url = "http://127.0.0.1:9191/one"
        wait_for(
            cdp,
            "[...document.querySelectorAll('[role=option]')].some(item=>"
            "item.textContent.includes(" + json.dumps(url) + ")&&"
            "item.getAttribute('data-value')?.startsWith(" + json.dumps(str(tab_id) + " ") + "))",
        )
        cdp.evaluate(
            "(()=>{const item=[...document.querySelectorAll('[role=option]')]"
            ".find(option=>option.textContent.includes(" + json.dumps(url) + ")&&"
            "option.getAttribute('data-value')?.startsWith(" + json.dumps(str(tab_id) + " ") + "));"
            "if(!item)throw Error('fixture tab is missing from the Tabs picker');item.click()})()"
        )
        wait_for(
            cdp,
            "document.querySelector('[aria-label=\"Select tabs\"]')?.innerText.includes("
            + json.dumps(f"{index} selected")
            + ")",
        )
    selected_ids = cdp.evaluate(
        "[...document.querySelectorAll('button')].find(b=>"
        "/^Tabs1$/.test(b.textContent.trim()))?.innerText"
    )
    if not selected_ids:
        raise RuntimeError(f"Fixture tab was not attached in the home composer: {selected_ids!r}")


def wait_for_fixture_state(condition, description: str, base: str, cdp: CDP) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.05)
    chat_text = cdp.evaluate("document.body.innerText.slice(-2000)")
    input_values = {}
    for route in ("/one", "/two"):
        try:
            input_values[route] = fixture_dom(base, route, "#value.value")
        except Exception as error:
            input_values[route] = f"unavailable: {error}"
    snapshot_lines = [
        line for line in chat_text.splitlines() if "[ref=e" in line
    ]
    raise TimeoutError(
        f"Timed out waiting for {description}; fixture input values: {input_values}; "
        f"snapshot ref lines: {snapshot_lines}; chat tail: {chat_text}"
    )


def fixture_dom(base: str, route: str, expression: str):
    url = f"http://127.0.0.1:9191{route}"
    targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=5))
    target = next(
        (
            item
            for item in targets
            if item.get("type") == "page" and item.get("url") == url
        ),
        None,
    )
    if target is None:
        return None
    fixture_cdp = CDP(target["webSocketDebuggerUrl"])
    fixture_cdp.call("Runtime.enable")
    try:
        selector, property_name = expression.split(".", 1)
        return fixture_cdp.evaluate(
            f"document.querySelector({json.dumps(selector)})?.{property_name}"
        )
    finally:
        fixture_cdp.ws.close()


def set_value(cdp: CDP, selector: str, value: str) -> None:
    cdp.evaluate(
        "(() => {const input=document.querySelector("
        + json.dumps(selector)
        + ");const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;"
        + "setter.call(input,"
        + json.dumps(value)
        + ");input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"
        + json.dumps(value)
        + "}));return input.value})()"
    )


if __name__ == "__main__":
    raise SystemExit(main())
