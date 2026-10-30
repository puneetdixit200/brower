#!/usr/bin/env python3
"""Headed BrowserOS UI -> local sidecar -> Browser MCP page-read smoke.

Requires an already running disposable BrowserOS dev session and its local
sidecar. The configured fixture endpoint URLs use loopback; redirects are not
blocked, and the harness does not claim that the browser enforces an egress firewall.
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

TITLE = "Aster UI Page Read Fixture"
SENTINEL = "ASTER_UI_PAGE_READ_SENTINEL_81D2"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--server-port", type=int, required=True)
    parser.add_argument("--target-timeout", type=float, default=12)
    args = parser.parse_args()
    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    api = f"http://127.0.0.1:{args.server_port}"
    provider_id = f"aster-ui-read-{uuid.uuid4().hex}"
    provider_key = "aster-ui-read-dummy-only"
    requests: list[dict] = []

    class PageHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = f"<!doctype html><meta charset=utf-8><title>{TITLE}</title><main><h1>{TITLE}</h1><p>{SENTINEL}</p></main>".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    class ModelHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            requests.append(request)
            names = [t.get("function", {}).get("name") for t in request.get("tools", [])]
            messages = request.get("messages", [])
            history = [m for m in messages if isinstance(m, dict)]
            calls = [c.get("function", {}).get("name") for m in history for c in m.get("tool_calls", [])]
            last_tool_result = next((m.get("content", "") for m in reversed(history) if m.get("role") == "tool"), "")
            if SENTINEL in str(last_tool_result) and TITLE in str(last_tool_result):
                reply = f"I read {TITLE}. The page sentinel is {SENTINEL}."
                payload = {"choices": [{"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}]}
            else:
                if not calls:
                    tool = "tabs"
                    arguments = {"action": "list"}
                elif calls[-1] == "tabs":
                    text = "\n".join(str(m.get("content", "")) for m in history if m.get("role") == "tool")
                    page_id = None
                    import re
                    match = re.search(r"\[(\d+)\]\s+http://127\.0\.0\.1:\d+/fixture(?:\s|\()", text, re.I)
                    if match:
                        page_id = int(match.group(1))
                    if page_id is None:
                        # Some tool results serialize their tab record as JSON.
                        import re
                        match = re.search(r'"id"\s*:\s*(\d+)[^}]*"url"\s*:\s*"http://127\\.0\\.0\\.1:\\d+/fixture"', text)
                        if match: page_id = int(match.group(1))
                    if page_id is None:
                        reply = "The local fixture tab was not listed."
                        payload = {"choices": [{"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}]}
                        self._complete(payload); return
                    tool, arguments = "read", {"page": page_id, "format": "text"}
                else:
                    reply = "The browser read did not return the expected fixture text."
                    payload = {"choices": [{"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}]}
                    self._complete(payload); return
                if tool not in names:
                    self.send_error(500, f"expected Browser MCP tool {tool}; got {names}"); return
                payload = {"choices": [{"index": 0, "message": {"role": "assistant", "tool_calls": [{"id": f"read-{len(requests)}", "type": "function", "function": {"name": tool, "arguments": json.dumps(arguments)}}]}, "finish_reason": "tool_calls"}]}
            self._complete(payload)

        def _complete(self, payload: dict) -> None:
            choice = payload["choices"][0]
            message = choice["message"]
            delta = {"role": "assistant"}
            finish = choice["finish_reason"]
            if "tool_calls" in message:
                delta["tool_calls"] = [
                    {"index": i, **call} for i, call in enumerate(message["tool_calls"])
                ]
            else:
                delta["content"] = message.get("content", "")
            chunks = [
                {"id": f"aster-ui-read-{len(requests)}", "object": "chat.completion.chunk", "created": 1, "model": "aster-test-mock", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                {"id": f"aster-ui-read-{len(requests)}", "object": "chat.completion.chunk", "created": 1, "model": "aster-test-mock", "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]},
            ]
            data = ("".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args: object) -> None:
            return

    page_server = ThreadingHTTPServer(("127.0.0.1", 0), PageHandler)
    model_server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
    for server in (page_server, model_server):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    page_url = f"http://127.0.0.1:{page_server.server_port}/fixture"
    cdp: CDP | None = None
    sidepanel: CDP | None = None
    tab_id: int | None = None
    previous_default: str | None = None
    provider_url = f"http://127.0.0.1:{model_server.server_port}/v1"
    try:
        target = wait_target(cdp_base, lambda t: t.get("type") == "page" and t.get("url", "").startswith("chrome-extension://") and t.get("url", "").partition("#")[0].endswith("/app.html"), args.target_timeout)
        cdp = CDP(target["webSocketDebuggerUrl"])
        cdp.call("Runtime.enable")
        cdp.evaluate("location.hash='#/home'")
        wait_js(cdp, "!!document.querySelector('textarea')")
        previous_default = cdp.evaluate(f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)")
        provider = {"type": "openai-compatible", "name": "Aster UI Page Read Fixture Provider", "baseUrl": provider_url, "modelId": "aster-test-mock", "supportsImages": False, "contextWindow": 32000, "temperature": 0, "apiKey": provider_key, "createdAt": int(time.time() * 1000)}
        setup = cdp.evaluate(f"(async()=>{{const h={{'Content-Type':'application/json'}};let created=false;try{{const s=await fetch({json.dumps(api + '/providers/' + provider_id)},{{method:'PUT',headers:h,body:JSON.stringify({json.dumps(provider)})}});if(!s.ok)return {{created:false,providerStatus:s.status}};created=true;const d=await fetch({json.dumps(api + '/providers/default')},{{method:'PUT',headers:h,body:JSON.stringify({{providerId:{json.dumps(provider_id)}}})}});return {{created,selected:d.status}}}}catch(e){{return {{created,error:String(e)}}}}}})()")
        if setup != {"created": True, "selected": 200}:
            raise RuntimeError(f"mock provider setup failed: {setup}")
        tab = cdp.evaluate(f"chrome.tabs.create({{url:{json.dumps(page_url)},active:true}}).then(t=>t.id)")
        tab_id = int(tab)
        page_target = wait_target(cdp_base, lambda t: t.get("type") == "page" and t.get("url") == page_url)
        page_cdp = CDP(page_target["webSocketDebuggerUrl"])
        page_cdp.call("Runtime.enable")
        try:
            wait_js(page_cdp, f"document.title === {json.dumps(TITLE)}")
        finally:
            page_cdp.ws.close()
        # CDP Runtime.evaluate is issued with userGesture enabled by the shared
        # CDP helper; Chrome therefore applies its user-activation gate for the
        # sidePanel.open API rather than relying on an extension auto-open.
        opened = cdp.evaluate(f"(async()=>{{await chrome.sidePanel.setOptions({{tabId:{tab_id},path:{json.dumps(f'sidepanel.html?tabId={tab_id}')},enabled:true}});await chrome.sidePanel.open({{tabId:{tab_id}}});return true}})()")
        if opened is not True:
            raise RuntimeError(f"side panel did not open from the extension user gesture: {opened!r}")
        panel_target = wait_target(cdp_base, lambda t: t.get("type") == "page" and "sidepanel.html" in t.get("url", "") and f"tabId={tab_id}" in t.get("url", ""))
        sidepanel = CDP(panel_target["webSocketDebuggerUrl"])
        sidepanel.call("Runtime.enable")
        wait_js(sidepanel, "!!document.querySelector('textarea')")
        prompt = "Read the open local fixture page using the browser tools and report its exact title and sentinel."
        set_textarea(sidepanel, prompt)
        sidepanel.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send')?.click()")
        wait_js(sidepanel, f"[...document.querySelectorAll('.is-assistant .size-full')].at(-1)?.innerText.includes({json.dumps(SENTINEL)})", timeout=150)
        visible = sidepanel.evaluate("[...document.querySelectorAll('.is-assistant .size-full')].at(-1)?.innerText || ''")
        if TITLE not in visible or SENTINEL not in visible:
            raise AssertionError("final assistant answer did not contain both fixture values")
        if len(requests) < 3:
            raise AssertionError(f"expected list/read/final provider turns, got {len(requests)}")
        invoked_tools = list(dict.fromkeys(
            call.get("function", {}).get("name")
            for request in requests
            for message in request.get("messages", [])
            if isinstance(message, dict)
            for call in message.get("tool_calls", [])
        ))
        if invoked_tools != ["tabs", "read"]:
            raise AssertionError(f"expected the real Browser MCP tabs/read calls, got {invoked_tools}")
        if not all(any(t.get("function", {}).get("name") == name for t in r.get("tools", [])) for r in requests for name in ("tabs", "read")):
            raise AssertionError("provider did not receive the advertised Browser MCP tools")
        print(json.dumps({"result": "passed", "surface": "headed BrowserOS side panel", "fixture_url": page_url, "browser_mcp_tools_called": invoked_tools, "tool_round_trips": len(invoked_tools), "provider_turns": len(requests), "final_reply_contains_title": TITLE in visible, "final_reply_contains_sentinel": SENTINEL in visible, "provider_credential": "synthetic dummy only", "fixture_endpoints": "127.0.0.1 loopback", "egress_enforcement_claim": False}, indent=2))
        return 0
    finally:
        if sidepanel:
            sidepanel.ws.close()
        if cdp:
            try:
                if tab_id is not None:
                    cdp.evaluate(f"chrome.tabs.remove({tab_id}).catch(()=>{{}})")
                # Attempt restoration even if setup's CDP response was lost after
                # the sidecar committed one of the two writes.
                restored = True
                if previous_default:
                    restored = cdp.evaluate(f"fetch({json.dumps(api + '/providers/default')},{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{providerId:{json.dumps(previous_default)}}})}}).then(r=>r.ok)") is True
                if restored:
                    deleted = cdp.evaluate(f"fetch({json.dumps(api + '/providers/' + provider_id)},{{method:'DELETE'}}).then(r=>r.ok || r.status===404)") is True
                    if not deleted:
                        print("cleanup warning: could not delete temporary provider", file=sys.stderr)
                else:
                    print("cleanup warning: prior provider selection not confirmed; temporary provider retained", file=sys.stderr)
            except Exception as e:
                print(f"cleanup warning: {e}", file=sys.stderr)
            cdp.ws.close()
        page_server.shutdown(); page_server.server_close()
        model_server.shutdown(); model_server.server_close()


def wait_target(base: str, predicate, timeout: float = 45) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/json/list", timeout=2) as response:
                for target in json.load(response):
                    if predicate(target): return target
        except Exception:
            time.sleep(0.2)
        time.sleep(0.2)
    raise TimeoutError("target did not appear in the BrowserOS CDP endpoint")


def wait_js(cdp: CDP, expression: str, timeout: float = 40) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression): return
        except Exception: pass
        time.sleep(0.2)
    raise TimeoutError(f"UI condition timed out: {expression}")


def set_textarea(cdp: CDP, value: str) -> None:
    cdp.evaluate("(()=>{const e=document.querySelector('textarea');if(!e)throw Error('composer textarea missing');const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(e," + json.dumps(value) + ");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()")


if __name__ == "__main__":
    raise SystemExit(main())
