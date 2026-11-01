#!/usr/bin/env python3
"""Verify attached page identity through the visible sidepanel composer.

Run against an already running disposable headed BrowserOS session and local
sidecar. The smoke configures a temporary dummy provider served by its own
loopback fixture; the provider returns a generic acknowledgement without
reading page content. It restores/removes the provider and does not launch
BrowserOS or contact an external model provider.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))
from aster_ui_latency_benchmark import CDP  # noqa: E402

FIXTURE_REPLY = "Loopback fixture received the request; it did not read page content."


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--server-port", type=int, required=True)
    parser.add_argument("--target-timeout", type=float, default=20)
    args = parser.parse_args()

    nonce = f"{time.time_ns():x}"
    titles = [f"Aster identity fixture {nonce} A", f"Aster identity fixture {nonce} B"]
    provider_requests: list[dict] = []

    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            index = 1 if self.path.startswith("/b") else 0
            body = (
                "<!doctype html><meta charset=utf-8><title>"
                + titles[index]
                + "</title><main><h1>"
                + titles[index]
                + "</h1></main>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            provider_requests.append(
                json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            )
            chunks = [
                {
                    "id": f"aster-chat-identity-{len(provider_requests)}",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "aster-identity-fixture",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "role": "assistant",
                                "content": "Loopback fixture received the request; it did not read page content.",
                            },
                            "finish_reason": None,
                        }
                    ],
                },
                {
                    "id": f"aster-chat-identity-{len(provider_requests)}",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "aster-identity-fixture",
                    "choices": [
                        {"index": 0, "delta": {}, "finish_reason": "stop"}
                    ],
                },
            ]
            payload = (
                "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
                + "data: [DONE]\n\n"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args: object) -> None:
            return

    fixture = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    worker = threading.Thread(target=fixture.serve_forever, daemon=True)
    worker.start()
    base = f"http://127.0.0.1:{fixture.server_port}"
    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    api = f"http://127.0.0.1:{args.server_port}"
    provider_id = f"aster-chat-identity-{uuid.uuid4().hex}"
    app: CDP | None = None
    panel: CDP | None = None
    fixture_ids: list[int] = []
    previous_default: str | None = None
    success_report: dict | None = None
    try:
        version = json.load(urlopen(f"{cdp_base}/json/version", timeout=3))
        del version  # Confirm the caller-owned CDP endpoint is reachable.
        app_target = wait_target(
            cdp_base,
            lambda item: item.get("type") == "page"
            and "chrome-extension://" in item.get("url", "")
            and "/app.html" in item.get("url", ""),
            args.target_timeout,
        )
        app = CDP(app_target["webSocketDebuggerUrl"])
        app.call("Runtime.enable")
        previous_default = app.evaluate(
            f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
        )
        provider = {
            "type": "openai-compatible",
            "name": "Aster Chat Identity Loopback Ack Fixture",
            "baseUrl": base + "/v1",
            "modelId": "aster-identity-no-model",
            "supportsImages": False,
            "contextWindow": 32000,
            "temperature": 0,
            "apiKey": "aster-chat-identity-dummy-only",
            "createdAt": int(time.time() * 1000),
        }
        setup = app.evaluate(
            f"(async()=>{{const h={{'Content-Type':'application/json'}};"
            f"const s=await fetch({json.dumps(api + '/providers/' + provider_id)},"
            f"{{method:'PUT',headers:h,body:JSON.stringify({json.dumps(provider)})}});"
            "if(!s.ok)return {created:false,providerStatus:s.status};"
            "try{"
            f"const d=await fetch({json.dumps(api + '/providers/default')},"
            f"{{method:'PUT',headers:h,body:JSON.stringify({{providerId:{json.dumps(provider_id)}}})}});"
            "return {created:true,selected:d.status}"
            "}catch(e){return {created:true,selectedError:String(e)}}})()"
        )
        if setup != {"created": True, "selected": 200}:
            raise RuntimeError(f"loopback failure provider setup failed: {setup!r}")
        fixture_ids = app.evaluate(
            "Promise.all(["
            f"chrome.tabs.create({{url:{json.dumps(base + '/a')},active:true}}),"
            f"chrome.tabs.create({{url:{json.dumps(base + '/b')},active:false}})"
            "]).then(tabs=>tabs.map(tab=>tab.id))"
        )
        if not isinstance(fixture_ids, list) or len(fixture_ids) != 2:
            raise RuntimeError(f"could not create the two loopback pages: {fixture_ids!r}")
        owner_id, attached_id = fixture_ids
        opened = app.evaluate(
            "(async()=>{"
            f"await chrome.sidePanel.setOptions({{tabId:{owner_id},path:{json.dumps(f'sidepanel.html?tabId={owner_id}')},enabled:true}});"
            f"await chrome.sidePanel.open({{tabId:{owner_id}}});return true}})()"
        )
        if opened is not True:
            raise RuntimeError(f"sidepanel did not open for fixture tab {owner_id}")
        panel_target = wait_target(
            cdp_base,
            lambda item: item.get("type") == "page"
            and "sidepanel.html" in item.get("url", "")
            and f"tabId={owner_id}" in item.get("url", ""),
            args.target_timeout,
        )
        panel = CDP(panel_target["webSocketDebuggerUrl"])
        panel.call("Runtime.enable")
        wait_js(panel, "!!document.querySelector('textarea')")
        panel.evaluate(
            "(()=>{window.__asterChatBodies=[];const original=window.fetch.bind(window);"
            "window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;"
            "if(url.includes('/chat')){let body=init?.body;"
            "if(body==null&&input instanceof Request)body=await input.clone().text();"
            "try{window.__asterChatBodies.push(JSON.parse(body))}catch{}}"
            "return original(input,init)}})()"
        )

        # The owning sidepanel page is auto-attached. Attach page B with the
        # visible picker so the journey exercises the real selection UI.
        picker_select(panel, titles[1])
        wait_js(
            panel,
            f"document.body.innerText.includes({json.dumps(titles[0])})&&document.body.innerText.includes({json.dumps(titles[1])})",
        )

        # With B explicitly attached from A's panel, the attachment is the
        # complete page context. A must not leak through as activeTab.
        set_textarea(panel, f"Submit attached Page B from Page A's panel {nonce}")
        click_send(panel)
        wait_js(panel, "window.__asterChatBodies.length > 0", timeout=45)
        body_attached_b = panel.evaluate("window.__asterChatBodies[0]")
        assert_attached_page_projection(
            body_attached_b,
            expected_id=attached_id,
            expected_window_id=app.evaluate(
                f"chrome.tabs.get({attached_id}).then(tab=>tab.windowId)"
            ),
            expected_url=base + "/b",
            owner_id=owner_id,
            owner_url=base + "/a",
            owner_title=titles[0],
        )
        wait_for_fixture_replies(panel, 1)

        # Navigate the attached page after selection. The send must fail before
        # /chat is called, with a visible explanation instead of using the new
        # address or whichever tab happens to be active.
        picker_select(panel, titles[1])
        changed_url = base + "/b?changed=1"
        app.evaluate(
            f"chrome.tabs.update({attached_id},{{url:{json.dumps(changed_url)}}}).then(()=>true)"
        )
        set_textarea(panel, f"Check the submitted page identities {nonce}")
        click_send(panel)
        wait_js(
            panel,
            f"document.body.innerText.includes({json.dumps('An attached page changed its address after context selection.')})",
            timeout=20,
        )
        captured_after_stale = panel.evaluate("window.__asterChatBodies.length")
        if captured_after_stale != 1:
            raise AssertionError("stale-page refusal happened after a /chat request")

        # Remove the stale B chip. The panel belongs to A, so this turn proves
        # an A-only context projection even though B exists in the same window.
        panel.evaluate(
            "(()=>{const chip=[...document.querySelectorAll('div')].find(e=>e.textContent.includes("
            + json.dumps(titles[1])
            + ")&&e.querySelector('button[title=\"Remove tab\"]'));"
            "chip?.querySelector('button[title=\"Remove tab\"]').click()})()"
        )
        set_textarea(panel, f"Submit the selected Page A context {nonce}")
        click_send(panel)
        wait_js(panel, "window.__asterChatBodies.length > 1", timeout=45)
        body_a = panel.evaluate("window.__asterChatBodies[1]")
        assert_single_page_projection(
            body_a,
            expected_id=owner_id,
            expected_url=base + "/a",
            other_id=attached_id,
            other_url=changed_url,
            other_title=titles[1],
            label="Page A",
        )
        wait_for_fixture_replies(panel, 2)
        if len(provider_requests) != 2:
            raise AssertionError(
                f"expected two local provider requests for two submitted turns; got {len(provider_requests)}"
            )

        success_report = {
            "result": "passed",
            "surface": "headed BrowserOS sidepanel",
            "positive": "attached Page B from Page A's panel omitted owner context; after removing B, Page A-only projection reached /chat",
            "negative": "navigation-changed page displayed an error before /chat",
            "fixture_tab_ids": fixture_ids,
            "provider_endpoint": "temporary dummy OpenAI-compatible provider on 127.0.0.1",
            "provider_requests": len(provider_requests),
            "provider_reply": "generic acknowledgement only; did not read page content",
            "evidence_boundary": "headed context-to-/chat and generic local-provider completion only; no Browser MCP read or model-semantic assertion",
        }
    finally:
        cleanup_errors: list[str] = []
        for opened_panel in (panel,):
            if opened_panel:
                try:
                    opened_panel.ws.close()
                except Exception as error:
                    cleanup_errors.append(f"sidepanel websocket close failed: {error}")
        if app:
            if fixture_ids:
                try:
                    removed = app.evaluate(
                        "Promise.all("
                        + json.dumps(fixture_ids)
                        + ".map(async id=>{try{await chrome.tabs.remove(id);return true}"
                        "catch{try{await chrome.tabs.get(id);return false}catch{return true}}}))"
                    )
                    if removed != [True, True]:
                        cleanup_errors.append(
                            f"fixture tab cleanup was not confirmed: {removed!r}"
                        )
                except Exception as error:
                    cleanup_errors.append(f"fixture tab cleanup failed: {error}")

            if previous_default:
                try:
                    restored = app.evaluate(
                        f"fetch({json.dumps(api + '/providers/default')},"
                        f"{{method:'PUT',headers:{{'Content-Type':'application/json'}},"
                        f"body:JSON.stringify({{providerId:{json.dumps(previous_default)}}})}}).then(r=>r.ok)"
                    ) is True
                    if not restored:
                        cleanup_errors.append("previous provider restoration was not confirmed")
                except Exception as error:
                    cleanup_errors.append(f"previous provider restoration failed: {error}")

            # Delete even if provider setup partially failed: its random ID is
            # owned by this smoke, and removing the default row clears a
            # possibly committed selection when there was no previous default.
            try:
                deleted = app.evaluate(
                    f"fetch({json.dumps(api + '/providers/' + provider_id)},"
                    "{method:'DELETE'}).then(r=>r.ok||r.status===404)"
                ) is True
                if not deleted:
                    cleanup_errors.append("temporary provider deletion was not confirmed")
            except Exception as error:
                cleanup_errors.append(f"temporary provider deletion failed: {error}")

            if previous_default:
                try:
                    current_default = app.evaluate(
                        f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
                    )
                    if current_default != previous_default:
                        restored = app.evaluate(
                            f"fetch({json.dumps(api + '/providers/default')},"
                            f"{{method:'PUT',headers:{{'Content-Type':'application/json'}},"
                            f"body:JSON.stringify({{providerId:{json.dumps(previous_default)}}})}}).then(r=>r.ok)"
                        ) is True
                        if not restored:
                            cleanup_errors.append("provider default did not return to its prior value")
                        current_default = app.evaluate(
                            f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
                        )
                    if current_default != previous_default:
                        cleanup_errors.append("provider default after cleanup did not match its prior value")
                except Exception as error:
                    cleanup_errors.append(f"provider default verification failed: {error}")
            else:
                try:
                    current_default = app.evaluate(
                        f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
                    )
                    if current_default is not None:
                        cleanup_errors.append(
                            "provider default remained set although there was no prior default"
                        )
                except Exception as error:
                    cleanup_errors.append(f"provider default verification failed: {error}")

            try:
                app.ws.close()
            except Exception as error:
                cleanup_errors.append(f"app websocket close failed: {error}")
        try:
            fixture.shutdown()
        except Exception as error:
            cleanup_errors.append(f"fixture shutdown failed: {error}")
        try:
            fixture.server_close()
        except Exception as error:
            cleanup_errors.append(f"fixture server close failed: {error}")
        try:
            worker.join(timeout=3)
            if worker.is_alive():
                cleanup_errors.append("fixture server worker did not stop")
        except Exception as error:
            cleanup_errors.append(f"fixture worker join failed: {error}")
        if cleanup_errors:
            raise RuntimeError("fixture cleanup failed: " + "; ".join(cleanup_errors))
    if success_report is None:
        raise RuntimeError("smoke completed without a success report")
    print(json.dumps(success_report, indent=2))
    return 0


def wait_target(base: str, predicate, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(f"{base}/json/list", timeout=2) as response:
                for target in json.load(response):
                    if predicate(target):
                        return target
        except Exception:
            time.sleep(0.2)
        time.sleep(0.2)
    raise TimeoutError("expected BrowserOS extension target did not appear")


def wait_js(cdp: CDP, expression: str, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression):
                return
        except Exception:
            pass
        time.sleep(0.2)
    try:
        visible = cdp.evaluate("document.body.innerText.slice(-2000)")
    except Exception as error:
        visible = f"UI text unavailable: {error}"
    raise TimeoutError(f"UI condition timed out: {expression}; visible tail: {visible!r}")


def wait_for_fixture_replies(cdp: CDP, count: int) -> None:
    wait_js(
        cdp,
        f"document.body.innerText.split({json.dumps(FIXTURE_REPLY)}).length - 1 >= {count}",
        timeout=20,
    )


def picker_select(cdp: CDP, title: str) -> None:
    cdp.evaluate("document.querySelector('button[data-tab-mention-trigger]')?.click()")
    wait_js(cdp, "!!document.querySelector('[role=dialog] [data-mention-item]')")
    selected = cdp.evaluate(
        "(()=>{const item=[...document.querySelectorAll('[role=dialog] [data-mention-item]')]"
        " .find(e=>e.innerText.includes(" + json.dumps(title) + "));"
        "if(!item)return false;item.click();return true})()"
    )
    if selected is not True:
        raise AssertionError(f"visible tab picker did not list {title!r}")


def assert_single_page_projection(
    body: dict | None,
    *,
    expected_id: int,
    expected_url: str,
    other_id: int,
    other_url: str,
    other_title: str,
    label: str,
) -> None:
    if not isinstance(body, dict):
        raise AssertionError(f"{label} /chat body was not an object: {body!r}")
    context = body.get("browserContext") or {}
    selected = context.get("selectedTabs") or []
    active = context.get("activeTab") or {}
    pages = [*selected, *([active] if active.get("id") is not None else [])]
    if [tab.get("id") for tab in pages] != [expected_id]:
        raise AssertionError(f"{label} request should identify only page {expected_id}: {pages!r}")
    if pages[0].get("url") != expected_url:
        raise AssertionError(f"{label} page URL mismatch: {pages[0]!r}")
    if other_id in {tab.get("id") for tab in pages}:
        raise AssertionError(f"{label} request also identified the other page")
    serialized = json.dumps(body)
    if other_url in serialized or other_title in serialized:
        raise AssertionError(f"{label} request leaked the other page's URL or title")


def assert_attached_page_projection(
    body: dict | None,
    *,
    expected_id: int,
    expected_window_id: int,
    expected_url: str,
    owner_id: int,
    owner_url: str,
    owner_title: str,
) -> None:
    if not isinstance(body, dict):
        raise AssertionError(f"attached Page B /chat body was not an object: {body!r}")
    context = body.get("browserContext") or {}
    selected = context.get("selectedTabs") or []
    if len(selected) != 1 or selected[0].get("id") != expected_id:
        raise AssertionError(f"attached Page B should be the only selected tab: {selected!r}")
    if selected[0].get("windowId") != expected_window_id:
        raise AssertionError(f"attached Page B window identity mismatch: {selected[0]!r}")
    if selected[0].get("url") != expected_url:
        raise AssertionError(f"attached Page B URL mismatch: {selected[0]!r}")
    if context.get("activeTab") is not None or context.get("windowId") is not None:
        raise AssertionError(f"owner tab leaked into attached-page context: {context!r}")
    serialized = json.dumps(body)
    if owner_id in {tab.get("id") for tab in selected}:
        raise AssertionError(f"owner page {owner_id} leaked as an attachment")
    if owner_url in serialized or owner_title in serialized:
        raise AssertionError("owner page URL or title leaked into attached-page request")


def set_textarea(cdp: CDP, value: str) -> None:
    cdp.evaluate(
        "(()=>{const e=document.querySelector('textarea');if(!e)throw Error('composer missing');"
        "Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"
        + json.dumps(value)
        + ");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
    )


def click_send(cdp: CDP) -> None:
    clicked = cdp.evaluate(
        "(()=>{const button=[...document.querySelectorAll('button')]"
        ".find(e=>e.textContent.trim()==='Send');if(!button)return false;button.click();return true})()"
    )
    if clicked is not True:
        raise RuntimeError("visible Send button was not found")


if __name__ == "__main__":
    raise SystemExit(main())
