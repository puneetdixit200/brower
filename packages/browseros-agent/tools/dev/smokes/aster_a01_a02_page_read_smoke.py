#!/usr/bin/env python3
"""Verify selected-page Browser MCP reads through the headed BrowserOS chat UI.

This smoke reuses the existing CDP and visible tab-picker helpers. Its local
OpenAI-compatible provider is deterministic transport/data-grounding code: it
lists real Browser MCP tabs, reads only the URLs attached in the captured chat
request, and constructs its final fixture reply from the returned read text.
It is not evidence of model reasoning.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from aster_chat_page_identity_smoke import (  # noqa: E402
    CDP,
    click_send,
    set_textarea,
    wait_js,
    wait_target,
)


def _message_text(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(part.get("text", "")) for part in content if isinstance(part, dict)
        )
    return str(content)


def _json_response(message: dict, finish: str = "stop") -> dict:
    return {
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish,
            }
        ]
    }


def _tool_call(call_id: str, name: str, arguments: dict) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--server-port", type=int, required=True)
    parser.add_argument("--target-timeout", type=float, default=20)
    args = parser.parse_args()

    run_id = uuid.uuid4().hex[:12].upper()
    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    api = f"http://127.0.0.1:{args.server_port}"
    provider_id = f"aster-a01-a02-{uuid.uuid4().hex}"
    provider_key = "aster-a01-a02-dummy-only"

    pages = {
        "A": {
            "path": "/a",
            "title": "Orion Project — Authentication",
            "component": "Authentication",
            "status": "Complete",
            "token": f"ASTER_ORION_AUTH_{run_id}",
        },
        "B": {
            "path": "/b",
            "title": "Orion Project — Database Migration",
            "component": "Database Migration",
            "status": "Pending",
            "token": f"ASTER_ORION_DB_{run_id}",
        },
        "C": {
            "path": "/unrelated",
            "title": "Orion Project — Archive",
            "component": "Authentication",
            "status": "Blocked",
            "token": f"ASTER_ORION_MISLEAD_{run_id}",
        },
    }
    case_markers = {
        "A_ONLY": f"ASTER_CASE_A_ONLY_{run_id}",
        "B_ONLY": f"ASTER_CASE_B_ONLY_{run_id}",
        "COMPARE": f"ASTER_CASE_COMPARE_{run_id}",
        "CANCEL": f"ASTER_CASE_CANCEL_{run_id}",
        "NAVIGATE": f"ASTER_CASE_NAVIGATE_{run_id}",
        "DISAPPEAR": f"ASTER_CASE_DISAPPEAR_{run_id}",
        "PROVIDER_401": f"ASTER_CASE_PROVIDER_401_{run_id}",
    }
    marker_to_case = {marker: case for case, marker in case_markers.items()}

    provider_requests: list[dict] = []
    contexts: dict[str, dict] = {}
    context_waiting = {marker: threading.Event() for marker in case_markers.values()}
    context_ready = {marker: threading.Event() for marker in case_markers.values()}
    cancel_waiting = threading.Event()
    cancel_release = threading.Event()
    cancel_requested = threading.Event()
    read_started = threading.Event()
    issued_calls: list[dict] = []
    observed_results: dict[str, list[dict]] = {
        case: [] for case in case_markers
    }
    page_by_id: dict[str, dict[int, str]] = {case: {} for case in case_markers}
    failure_messages: list[str] = []
    provider_statuses: list[dict] = []
    context_lock = threading.Lock()

    class PageHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            if self.path.startswith("/read-start"):
                read_started.set()
                self.send_response(204)
                self.end_headers()
                return
            self.send_error(404)

        def do_GET(self) -> None:
            if self.path.startswith("/read-start"):
                read_started.set()
                self.send_response(204)
                self.end_headers()
                return
            spec = next(
                (page for page in pages.values() if self.path.startswith(page["path"])),
                None,
            )
            if spec is None:
                self.send_error(404)
                return
            delay_script = ""
            if "slowread=1" in self.path:
                delay_script = (
                    "<script>(()=>{const native=Object.getOwnPropertyDescriptor("
                    "HTMLElement.prototype,'innerText').get;Object.defineProperty("
                    "document.body,'innerText',{configurable:true,get(){"
                    "navigator.sendBeacon('/read-start?case='+(location.search.includes('disappear=1')?"
                    "'DISAPPEAR':'NAVIGATE'));"
                    "const end=performance.now()+1500;while(performance.now()<end){};"
                    "return native.call(this)}})})()</script>"
                )
            body = (
                "<!doctype html><meta charset=utf-8><title>"
                + spec["title"]
                + "</title><main><h1>Project: Orion</h1><p>Component: "
                + spec["component"]
                + "</p><p>Status: "
                + spec["status"]
                + "</p><p>Evidence token: "
                + spec["token"]
                + "</p></main>"
                + delay_script
            ).encode()
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
            request = json.loads(
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
            )
            provider_requests.append(request)
            messages = [
                item for item in request.get("messages", []) if isinstance(item, dict)
            ]
            serialized = "\n".join(_message_text(message) for message in messages)
            matches = [
                (serialized.rfind(marker), marker)
                for marker in marker_to_case
                if marker in serialized
            ]
            if not matches:
                failure_messages.append("provider request lost its per-turn marker")
                self._complete(
                    _json_response(
                        {"role": "assistant", "content": "Fixture turn marker missing."}
                    )
                )
                return
            marker = max(matches)[1]
            case = marker_to_case[marker]
            context_waiting[marker].set()
            if not context_ready[marker].wait(timeout=25):
                self._fixture_error(case, "UI did not verify the submitted page context")
                return
            if case == "PROVIDER_401":
                provider_statuses.append({"case": case, "status": 401})
                body = json.dumps(
                    {
                        "error": {
                            "message": "Synthetic provider authentication failure",
                            "type": "authentication_error",
                        }
                    }
                ).encode()
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            tools = request.get("tools", [])
            tool_names = {
                item.get("function", {}).get("name")
                for item in tools
                if isinstance(item, dict)
            }
            if not {"tabs", "read"}.issubset(tool_names):
                failure_messages.append(
                    f"provider did not receive both Browser MCP tools for {case}"
                )
                self._complete(
                    _json_response(
                        {"role": "assistant", "content": "Browser tools unavailable."}
                    )
                )
                return

            user_index = max(
                index
                for index, message in enumerate(messages)
                if marker in _message_text(message)
            )
            turn_messages = messages[user_index + 1 :]
            calls = [
                call
                for message in turn_messages
                for call in message.get("tool_calls", [])
                if isinstance(call, dict)
            ]
            results = {
                str(message.get("tool_call_id", message.get("toolCallId", ""))): message
                for message in turn_messages
                if message.get("role") == "tool"
            }
            call_names = [
                call.get("function", {}).get("name") for call in calls
            ]

            if not calls:
                call_id = f"a01-{case.lower()}-tabs"
                issued_calls.append(
                    {"case": case, "id": call_id, "name": "tabs", "arguments": {"action": "list"}}
                )
                self._complete(
                    _json_response(
                        {
                            "role": "assistant",
                            "tool_calls": [_tool_call(call_id, "tabs", {"action": "list"})],
                        },
                        "tool_calls",
                    )
                )
                return

            tabs_calls = [
                call
                for call in calls
                if call.get("function", {}).get("name") == "tabs"
            ]
            read_calls = [
                call
                for call in calls
                if call.get("function", {}).get("name") == "read"
            ]

            if tabs_calls and not read_calls:
                tabs_call = tabs_calls[-1]
                tabs_result = results.get(str(tabs_call.get("id", "")))
                if tabs_result is None:
                    self._fixture_error(case, "tabs result was not returned to the provider")
                    return
                listing = _message_text(tabs_result)
                urls = _selected_urls(contexts.get(marker))
                parsed_pages: dict[str, int] = {}
                for page_id_text, url in re.findall(
                    r"\[(\d+)\]\s+(https?://[^\s(]+)", listing
                ):
                    parsed_pages[url] = int(page_id_text)
                selected_ids: list[int] = []
                for url in urls:
                    page_id = parsed_pages.get(url)
                    if page_id is None:
                        self._fixture_error(
                            case, f"selected URL was absent from Browser MCP tabs: {url}"
                        )
                        return
                    selected_ids.append(page_id)
                    page_by_id[case][page_id] = url
                if len(set(selected_ids)) != len(urls) or not 1 <= len(urls) <= 2:
                    self._fixture_error(case, "selected page list was invalid")
                    return

                if case == "CANCEL":
                    cancel_waiting.set()
                    cancel_release.wait(timeout=20)
                    if cancel_requested.is_set():
                        # The browser's Stop aborted the provider request before
                        # any read tool call was returned to ChatService.
                        return

                new_reads = [
                    _tool_call(
                        f"a01-{case.lower()}-read-{index + 1}",
                        "read",
                        {"page": page_id, "format": "text"},
                    )
                    for index, page_id in enumerate(selected_ids)
                ]
                for call in new_reads:
                    issued_calls.append(
                        {
                            "case": case,
                            "id": call["id"],
                            "name": "read",
                            "arguments": json.loads(call["function"]["arguments"]),
                        }
                    )
                self._complete(
                    _json_response({"role": "assistant", "tool_calls": new_reads}, "tool_calls")
                )
                return

            if read_calls:
                if case in {"NAVIGATE", "DISAPPEAR"}:
                    if len(read_calls) != 1:
                        self._fixture_error(case, "expected one pending navigation read")
                        return
                    call = read_calls[0]
                    call_id = str(call.get("id", ""))
                    result_message = results.get(call_id)
                    if result_message is None:
                        self._fixture_error(case, "navigation read result was not returned")
                        return
                    result_text = _message_text(result_message)
                    error_match = re.fullmatch(
                        r"read: page ([0-9]+) navigated, changed, or closed during read; retry",
                        result_text.strip(),
                    )
                    args = json.loads(call.get("function", {}).get("arguments", "{}"))
                    page_id = int(args.get("page", -1))
                    if (
                        not error_match
                        or int(error_match.group(1)) != page_id
                        or page_id not in page_by_id[case]
                    ):
                        self._fixture_error(
                            case,
                            "pending-read result did not name the selected page's exact read error",
                        )
                        return
                    observed_results[case].append(
                        {
                            "toolCallId": call_id,
                            "page": page_id,
                            "url": page_by_id[case].get(page_id),
                            "content": result_text,
                        }
                    )
                    self._complete(
                        _json_response(
                            {
                                "role": "assistant",
                                "content": (
                                    "The selected source changed or disappeared during the read; its content is unavailable, "
                                    "so no page status is claimed. Browser MCP result: "
                                    + result_text
                                ),
                            }
                        )
                    )
                    return
                facts: list[str] = []
                for call in read_calls:
                    call_id = str(call.get("id", ""))
                    result_message = results.get(call_id)
                    if result_message is None:
                        self._fixture_error(case, f"read result {call_id} was not returned")
                        return
                    result_text = _message_text(result_message)
                    arguments = json.loads(call.get("function", {}).get("arguments", "{}"))
                    page_id = int(arguments.get("page", -1))
                    url = page_by_id[case].get(page_id)
                    component = re.search(r"Component:\s*([^\n<]+)", result_text)
                    status = re.search(r"Status:\s*([^\n<]+)", result_text)
                    evidence = re.search(r"Evidence token:\s*([A-Z0-9_]+)", result_text)
                    if not (url and component and status and evidence):
                        self._fixture_error(case, f"read result {call_id} lacked source facts")
                        return
                    observed_results[case].append(
                        {
                            "toolCallId": call_id,
                            "page": page_id,
                            "url": url,
                            "content": result_text,
                        }
                    )
                    facts.append(
                        f"{component.group(1).strip()}: {status.group(1).strip()} "
                        f"(source: {url}; evidence: {evidence.group(1)})"
                    )
                # This deterministic formatter uses only facts extracted from
                # returned read results; it never inserts expected page values.
                reply = "\n".join(facts)
                self._complete(_json_response({"role": "assistant", "content": reply}))
                return

            self._fixture_error(case, f"unexpected tool sequence: {call_names!r}")

        def _fixture_error(self, case: str, detail: str) -> None:
            failure_messages.append(f"{case}: {detail}")
            self._complete(
                _json_response(
                    {"role": "assistant", "content": f"Fixture could not verify the page data: {detail}"}
                )
            )

        def _complete(self, payload: dict) -> None:
            choice = payload["choices"][0]
            message = choice["message"]
            finish = choice["finish_reason"]
            delta: dict = {"role": "assistant"}
            if "tool_calls" in message:
                delta["tool_calls"] = [
                    {"index": index, **call}
                    for index, call in enumerate(message["tool_calls"])
                ]
            else:
                delta["content"] = message.get("content", "")
            request_id = f"aster-a01-a02-{len(provider_requests)}"
            chunks = [
                {
                    "id": request_id,
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "aster-a01-a02-deterministic",
                    "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
                },
                {
                    "id": request_id,
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "aster-a01-a02-deterministic",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
                },
            ]
            data = (
                "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
                + "data: [DONE]\n\n"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                # Expected when Stop aborts the deliberately delayed fixture turn.
                return

        def log_message(self, *_args: object) -> None:
            return

    fixture_server = ThreadingHTTPServer(("127.0.0.1", 0), PageHandler)
    model_server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
    workers = [
        threading.Thread(target=fixture_server.serve_forever, daemon=True),
        threading.Thread(target=model_server.serve_forever, daemon=True),
    ]
    for worker in workers:
        worker.start()

    base = f"http://127.0.0.1:{fixture_server.server_port}"
    for spec in pages.values():
        spec["url"] = base + spec["path"] + f"?run={run_id}"
    provider_url = f"http://127.0.0.1:{model_server.server_port}/v1"
    provider = {
        "type": "openai-compatible",
        "name": "Aster A01/A02 deterministic page-read fixture",
        "baseUrl": provider_url,
        "modelId": "aster-a01-a02-deterministic",
        "supportsImages": False,
        "contextWindow": 32000,
        "temperature": 0,
        "apiKey": provider_key,
        "createdAt": int(time.time() * 1000),
    }

    app: CDP | None = None
    panel: CDP | None = None
    page_ids: dict[str, int] = {}
    previous_default: str | None = None
    provider_created = False
    success_report: dict | None = None
    cleanup_errors: list[str] = []
    try:
        with urlopen(f"{cdp_base}/json/version", timeout=3) as response:
            json.load(response)
        app_target = wait_target(
            cdp_base,
            lambda target: target.get("type") == "page"
            and target.get("url", "").startswith("chrome-extension://")
            and target.get("url", "").partition("#")[0].endswith("/app.html"),
            args.target_timeout,
        )
        app = CDP(app_target["webSocketDebuggerUrl"])
        app.call("Runtime.enable")
        app.evaluate("location.hash='#/home'")
        wait_js(app, "!!document.querySelector('textarea')", timeout=args.target_timeout)
        previous_default = app.evaluate(
            f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
        )
        # Mark this for cleanup before the request: the server may create the
        # row even if the response or the following default-selection request
        # fails on the client side.
        provider_created = True
        setup = app.evaluate(
            f"(async()=>{{const h={{'Content-Type':'application/json'}};"
            f"const s=await fetch({json.dumps(api + '/providers/' + provider_id)},"
            f"{{method:'PUT',headers:h,body:JSON.stringify({json.dumps(provider)})}});"
            "if(!s.ok)return {created:false,status:s.status};"
            f"const d=await fetch({json.dumps(api + '/providers/default')},"
            f"{{method:'PUT',headers:h,body:JSON.stringify({{providerId:{json.dumps(provider_id)}}})}});"
            "return {created:true,selected:d.status}})()"
        )
        if setup != {"created": True, "selected": 200}:
            raise RuntimeError(f"could not configure deterministic local provider: {setup!r}")

        page_ids = app.evaluate(
            "Promise.allSettled(["
            + ",".join(
                f"chrome.tabs.create({{url:{json.dumps(spec['url'])},active:{'true' if key == 'C' else 'false'}}})"
                for key, spec in pages.items()
            )
            + "]).then(results=>results.flatMap(result=>result.status==='fulfilled'?[result.value.id]:[]))"
        )
        if not isinstance(page_ids, list) or len(page_ids) != 3:
            raise RuntimeError(f"could not create A/B/unrelated loopback tabs: {page_ids!r}")
        ids = dict(zip(pages.keys(), [int(value) for value in page_ids], strict=True))

        # The unrelated page owns the sidepanel. All useful page context must
        # therefore arrive through the visible picker as explicit attachments.
        opened = app.evaluate(
            "(async()=>{"
            f"await chrome.sidePanel.setOptions({{tabId:{ids['C']},path:{json.dumps(f'sidepanel.html?tabId={ids['C']}')},enabled:true}});"
            f"await chrome.sidePanel.open({{tabId:{ids['C']}}});return true}})()"
        )
        if opened is not True:
            raise RuntimeError("could not open the actual sidepanel for the unrelated owner page")
        panel_target = wait_target(
            cdp_base,
            lambda target: target.get("type") == "page"
            and "sidepanel.html" in target.get("url", "")
            and f"tabId={ids['C']}" in target.get("url", ""),
            args.target_timeout,
        )
        panel = CDP(panel_target["webSocketDebuggerUrl"])
        panel.call("Runtime.enable")
        wait_js(panel, "!!document.querySelector('textarea')", timeout=args.target_timeout)
        panel.evaluate(
            "(()=>{window.__asterChatBodies=[];const original=window.fetch.bind(window);"
            "window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;"
            "if(url.includes('/chat')){let body=init?.body;"
            "if(body==null&&input instanceof Request)body=await input.clone().text();"
            "try{window.__asterChatBodies.push(JSON.parse(body))}catch{}}"
            "return original(input,init)}})()"
        )

        # Remove C's implicit owner attachment before explicitly selecting A.
        _select_page(panel, pages["A"]["title"])
        case_results: dict[str, dict] = {}

        def submit_case(case: str, selected: list[str], question: str) -> dict:
            marker = case_markers[case]
            expected_urls = [pages[key]["url"] for key in selected]
            body_count = int(panel.evaluate("window.__asterChatBodies.length"))
            context_waiting[marker].clear()
            context_ready[marker].clear()
            set_textarea(panel, f"{question}\n\n{marker}")
            click_send(panel)
            if not context_waiting[marker].wait(timeout=25):
                raise TimeoutError(f"local provider did not receive case {case}")
            wait_js(
                panel,
                f"window.__asterChatBodies.length > {body_count}",
                timeout=25,
            )
            body = panel.evaluate(f"window.__asterChatBodies[{body_count}]")
            browser_context = body.get("browserContext") if isinstance(body, dict) else None
            context_urls = [
                tab.get("url")
                for tab in (browser_context or {}).get("selectedTabs", [])
            ]
            if set(context_urls) != set(expected_urls) or len(context_urls) != len(expected_urls):
                raise AssertionError(
                    f"{case} selected context mismatch: expected {expected_urls!r}, got {browser_context!r}"
                )
            selected_tabs = (browser_context or {}).get("selectedTabs", [])
            expected_identity = {
                ids[key]: pages[key]["url"] for key in selected
            }
            actual_identity = {
                tab.get("id"): tab.get("url")
                for tab in selected_tabs
                if isinstance(tab, dict)
            }
            if actual_identity != expected_identity or any(
                not isinstance(tab.get("windowId"), int)
                for tab in selected_tabs
                if isinstance(tab, dict)
            ):
                raise AssertionError(
                    f"{case} tab/window identity mismatch: expected {expected_identity!r}, got {selected_tabs!r}"
                )
            if (browser_context or {}).get("activeTab") or (browser_context or {}).get("windowId") is not None:
                raise AssertionError(f"{case} leaked the unrelated panel owner: {browser_context!r}")
            serialized = json.dumps(body)
            if any(
                value in serialized
                for value in (
                    pages["C"]["url"],
                    pages["C"]["title"],
                    pages["C"]["token"],
                    pages["C"]["status"],
                )
            ):
                raise AssertionError(f"{case} leaked the unrelated page context")
            with context_lock:
                contexts[marker] = browser_context
            context_ready[marker].set()

            if case == "CANCEL":
                if not cancel_waiting.wait(timeout=30):
                    raise TimeoutError("provider did not reach the delayed pre-read turn")
                stop_clicked = panel.evaluate(
                    "(()=>{const button=[...document.querySelectorAll('button')]"
                    ".find(item=>item.textContent.trim()==='Stop');"
                    "if(!button)return false;button.click();return true})()"
                )
                if stop_clicked is not True:
                    cancel_requested.set()
                    cancel_release.set()
                    raise AssertionError("visible Stop button was not available during the provider wait")
                cancel_requested.set()
                cancel_release.set()
                wait_js(
                    panel,
                    "![...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Stop')",
                    timeout=20,
                )
                time.sleep(0.2)
                if any(call["case"] == "CANCEL" and call["name"] == "read" for call in issued_calls):
                    raise AssertionError("a browser read was dispatched after Stop")
                case_results[case] = {
                    "selected_urls": expected_urls,
                    "tabs_read": sum(
                        call["case"] == case and call["name"] == "tabs" for call in issued_calls
                    ),
                    "read_calls": 0,
                    "stop_clicked": True,
                    "final_answer_claim": "none; request stopped before read dispatch",
                }
                return case_results[case]

            if case in {"NAVIGATE", "DISAPPEAR"}:
                if not read_started.wait(timeout=20):
                    raise TimeoutError("Browser MCP read never entered the delayed page getter")
                if case == "NAVIGATE":
                    navigated_url = base + pages["A"]["path"] + f"?run={run_id}&navigation=committed"
                    pending_target = wait_target(
                        cdp_base,
                        lambda target: target.get("type") == "page"
                        and target.get("url") == slow_read_url,
                        args.target_timeout,
                    )
                    page_cdp = CDP(pending_target["webSocketDebuggerUrl"])
                    try:
                        page_cdp.call("Page.navigate", {"url": navigated_url})
                    finally:
                        page_cdp.ws.close()
                    pages["A"]["url"] = navigated_url
                    wait_target(
                        cdp_base,
                        lambda target: target.get("type") == "page"
                        and target.get("url") == navigated_url,
                        args.target_timeout,
                    )
                else:
                    disappeared_url = "about:blank"
                    pending_target = wait_target(
                        cdp_base,
                        lambda target: target.get("type") == "page"
                        and target.get("url") == slow_close_url,
                        args.target_timeout,
                    )
                    page_cdp = CDP(pending_target["webSocketDebuggerUrl"])
                    try:
                        page_cdp.call("Page.navigate", {"url": disappeared_url})
                    finally:
                        page_cdp.ws.close()
                    pages["B"]["url"] = disappeared_url
                    wait_target(
                        cdp_base,
                        lambda target: target.get("type") == "page"
                        and target.get("url") == disappeared_url,
                        args.target_timeout,
                    )
                wait_js(
                    panel,
                    "document.body.innerText.includes('content is unavailable')",
                    timeout=35,
                )
                visible = panel.evaluate("document.body.innerText.slice(-2000)")
                if "no page status is claimed" not in visible:
                    raise AssertionError(f"navigation response did not avoid a stale status claim: {visible!r}")
                rows = observed_results[case]
                if len(rows) != 1 or not any(
                    phrase in rows[0]["content"].lower()
                    for phrase in ("navigated, changed, or closed", "read failed:")
                ):
                    raise AssertionError(f"pending navigation did not produce a read error: {rows!r}")
                case_results[case] = {
                    "selected_url_at_submit": expected_urls[0],
                    "interruption": "navigation" if case == "NAVIGATE" else "source navigated to about:blank",
                    "navigated_url_during_read": navigated_url if case == "NAVIGATE" else disappeared_url,
                    "tabs_calls": sum(
                        call["case"] == case and call["name"] == "tabs"
                        for call in issued_calls
                    ),
                    "read_calls": sum(
                        call["case"] == case and call["name"] == "read"
                        for call in issued_calls
                    ),
                    "tool_call_id": rows[0]["toolCallId"],
                    "read_error": rows[0]["content"],
                    "visible_answer": visible,
                    "stale_page_status_claimed": False,
                }
                return case_results[case]

            if case == "PROVIDER_401":
                wait_js(
                    panel,
                    "document.body.innerText.includes('Authentication failed') && "
                    "document.body.innerText.includes('Synthetic provider authentication failure')",
                    timeout=35,
                )
                visible = panel.evaluate("document.body.innerText.slice(-2000)")
                if provider_statuses.count({"case": case, "status": 401}) != 1:
                    raise AssertionError(f"provider fixture did not return exactly one 401: {provider_statuses!r}")
                if any(call["case"] == case for call in issued_calls):
                    raise AssertionError("Browser MCP was called after the provider rejected authentication")
                case_results[case] = {
                    "provider_status": 401,
                    "visible_error": visible,
                    "browser_tool_calls": 0,
                }
                return case_results[case]

            expected_tokens = [pages[key]["token"] for key in selected]
            expected_facts = [pages[key]["component"] + ": " + pages[key]["status"] for key in selected]
            wait_js(
                panel,
                "(() => {const e=[...document.querySelectorAll('.is-assistant .size-full')].at(-1);"
                f"return !!e && {json.dumps(expected_tokens)}.every(token=>e.innerText.includes(token))}})()",
                timeout=90,
            )
            visible = panel.evaluate(
                "[...document.querySelectorAll('.is-assistant .size-full')].at(-1)?.innerText || ''"
            )
            if not all(fact in visible for fact in expected_facts):
                raise AssertionError(f"{case} final assistant answer lacked returned page facts: {visible!r}")
            for key in selected:
                if pages[key]["url"] not in visible:
                    raise AssertionError(f"{case} final answer omitted source URL {pages[key]['url']!r}")
            if any(
                value in visible
                for value in (
                    pages["C"]["title"],
                    pages["C"]["status"],
                    pages["C"]["token"],
                )
            ):
                raise AssertionError(f"{case} final answer used the unrelated page: {visible!r}")
            result_rows = observed_results[case]
            if len(result_rows) != len(selected):
                raise AssertionError(
                    f"{case} expected {len(selected)} MCP read results, found {len(result_rows)}"
                )
            if {row["url"] for row in result_rows} != set(expected_urls):
                raise AssertionError(f"{case} read sources did not match selected URLs: {result_rows!r}")
            for key in selected:
                if not any(pages[key]["token"] in row["content"] for row in result_rows):
                    raise AssertionError(f"{case} MCP read result omitted {pages[key]['token']}")
            case_results[case] = {
                "selected_urls": expected_urls,
                "tabs_calls": sum(
                    call["case"] == case and call["name"] == "tabs" for call in issued_calls
                ),
                "read_calls": sum(
                    call["case"] == case and call["name"] == "read" for call in issued_calls
                ),
                "read_results": [
                    {
                        "page": row["page"],
                        "url": row["url"],
                        "provider_received_tool_call_id": row["toolCallId"],
                        "exact_text_returned_by_read": row["content"],
                    }
                    for row in result_rows
                ],
                "final_answer": visible,
            }
            return case_results[case]

        case_results["A_ONLY"] = submit_case(
            "A_ONLY",
            ["A"],
            "Read the Authentication component status from the selected page and cite its URL.",
        )

        _remove_attachment(panel, pages["A"]["title"])
        _select_page(panel, pages["B"]["title"])
        # Prove the stale attached URL is refused before /chat, then reattach
        # the live B page through the visible picker for the positive read.
        before_stale = int(panel.evaluate("window.__asterChatBodies.length"))
        changed_url = pages["B"]["url"] + "&changed=1"
        app.evaluate(
            f"chrome.tabs.update({ids['B']},{{url:{json.dumps(changed_url)}}}).then(()=>true)"
        )
        set_textarea(panel, f"Check the attached page identity {run_id}")
        click_send(panel)
        wait_js(
            panel,
            "document.body.innerText.includes('An attached page changed its address after context selection.')",
            timeout=20,
        )
        if int(panel.evaluate("window.__asterChatBodies.length")) != before_stale:
            raise AssertionError("stale B attachment reached /chat instead of failing closed")
        _remove_attachment(panel, pages["B"]["title"])
        pages["B"]["url"] = changed_url
        _select_page(panel, pages["B"]["title"])
        case_results["B_ONLY"] = submit_case(
            "B_ONLY",
            ["B"],
            "Read the Database Migration component status from the selected page and cite its URL.",
        )

        _select_page(panel, pages["B"]["title"])
        _select_page(panel, pages["A"]["title"])
        case_results["COMPARE"] = submit_case(
            "COMPARE",
            ["B", "A"],
            "Compare Authentication and Database Migration status, citing the webpage for each.",
        )

        _select_page(panel, pages["B"]["title"])
        _select_page(panel, pages["A"]["title"])
        case_results["CANCEL"] = submit_case(
            "CANCEL",
            ["B", "A"],
            "Read both selected pages and compare their statuses. Stop should cancel before any read.",
        )

        slow_read_url = base + pages["A"]["path"] + f"?run={run_id}&slowread=1"
        read_started.clear()
        updated = app.evaluate(
            f"chrome.tabs.update({ids['A']},{{url:{json.dumps(slow_read_url)}}}).then(()=>true)"
        )
        if updated is not True:
            raise AssertionError(f"could not dispatch delayed-read navigation: {updated!r}")
        pages["A"]["url"] = slow_read_url
        wait_target(
            cdp_base,
            lambda target: target.get("type") == "page" and target.get("url") == slow_read_url,
            args.target_timeout,
        )
        _select_page(panel, pages["A"]["title"])
        case_results["NAVIGATE"] = submit_case(
            "NAVIGATE",
            ["A"],
            "Read the selected Authentication page. If it changes during the read, report that it is unavailable.",
        )

        slow_close_url = base + pages["B"]["path"] + f"?run={run_id}&slowread=1&disappear=1"
        read_started.clear()
        updated = app.evaluate(
            f"chrome.tabs.update({ids['B']},{{url:{json.dumps(slow_close_url)}}}).then(()=>true)"
        )
        if updated is not True:
            raise AssertionError(f"could not dispatch disappearing-page navigation: {updated!r}")
        pages["B"]["url"] = slow_close_url
        wait_target(
            cdp_base,
            lambda target: target.get("type") == "page" and target.get("url") == slow_close_url,
            args.target_timeout,
        )
        _select_page(panel, pages["B"]["title"])
        case_results["DISAPPEAR"] = submit_case(
            "DISAPPEAR",
            ["B"],
            "Read the selected Database Migration page. If its source disappears during the read, report it unavailable.",
        )

        _select_page(panel, pages["A"]["title"])
        case_results["PROVIDER_401"] = submit_case(
            "PROVIDER_401",
            ["A"],
            "Test the provider connection and report any authentication failure clearly.",
        )

        for case, expected_count in (("A_ONLY", 1), ("B_ONLY", 1), ("COMPARE", 2)):
            if case_results[case]["tabs_calls"] != 1:
                raise AssertionError(f"{case} did not call Browser MCP tabs exactly once")
            if case_results[case]["read_calls"] != expected_count:
                raise AssertionError(
                    f"{case} expected {expected_count} Browser MCP reads; got {case_results[case]['read_calls']}"
                )
        if case_results["CANCEL"]["read_calls"] != 0:
            raise AssertionError("canceled task dispatched a read")
        if case_results["NAVIGATE"]["tabs_calls"] != 1 or case_results["NAVIGATE"]["read_calls"] != 1:
            raise AssertionError("navigation-during-read case did not dispatch exactly one tabs/read call")
        if case_results["DISAPPEAR"]["tabs_calls"] != 1 or case_results["DISAPPEAR"]["read_calls"] != 1:
            raise AssertionError("disappearing-page case did not dispatch exactly one tabs/read call")
        if case_results["PROVIDER_401"]["provider_status"] != 401:
            raise AssertionError("provider authentication case did not receive a 401")
        if len(provider_requests) != 18:
            raise AssertionError(
                f"expected exactly 18 provider turns across the fixture journeys, got {len(provider_requests)}"
            )
        if failure_messages:
            raise AssertionError(f"provider fixture errors: {failure_messages!r}")

        success_report = {
            "result": "passed",
            "runtime": "headed BrowserOS v0.51.0 / Chromium 155.0.8309.26 development session",
            "surface": "sidepanel visible picker and composer; fixture tabs/panel prepared through extension APIs",
            "provider": "deterministic local OpenAI-compatible fixture; no real-model semantics",
            "loopback_pages": {
                key: {"tab_id": ids[key], "url": spec["url"], "title": spec["title"], "token": spec["token"]}
                for key, spec in pages.items()
            },
            "cases": case_results,
            "actual_browser_mcp_calls": [
                {"case": call["case"], "name": call["name"], "arguments": call["arguments"], "tool_call_id": call["id"]}
                for call in issued_calls
            ],
            "provider_turns": len(provider_requests),
            "provider_statuses": provider_statuses,
            "provider_errors": failure_messages,
            "real_model_evaluation": "unavailable; no authorized configured model found",
            "egress_enforcement_claim": False,
            "cleanup": "passed; asserted after UI/provider checks",
        }
    finally:
        if panel:
            try:
                panel.ws.close()
            except Exception as error:
                cleanup_errors.append(f"sidepanel websocket close failed: {error}")

        if app and page_ids:
            try:
                removed = app.evaluate(
                    "Promise.all(" + json.dumps(page_ids) + ".map(async id=>{try{await chrome.tabs.remove(id);return true}"
                    "catch{try{await chrome.tabs.get(id);return false}catch{return true}}}))"
                )
                if removed != [True] * len(page_ids):
                    cleanup_errors.append(f"fixture tab removal was not confirmed: {removed!r}")
            except Exception as error:
                cleanup_errors.append(f"fixture tab cleanup failed: {error}")

        if app and provider_created:
            if previous_default:
                try:
                    restored = app.evaluate(
                        f"fetch({json.dumps(api + '/providers/default')},{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{providerId:{json.dumps(previous_default)}}})}}).then(r=>r.ok)"
                    ) is True
                    if not restored:
                        cleanup_errors.append("prior provider default restoration failed")
                except Exception as error:
                    cleanup_errors.append(f"prior provider default restoration errored: {error}")
            try:
                deleted = app.evaluate(
                    f"fetch({json.dumps(api + '/providers/' + provider_id)},{{method:'DELETE'}}).then(r=>r.ok||r.status===404)"
                ) is True
                if not deleted:
                    cleanup_errors.append("temporary provider deletion failed")
            except Exception as error:
                cleanup_errors.append(f"temporary provider deletion errored: {error}")
            try:
                current_default = app.evaluate(
                    f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
                )
                if current_default != previous_default:
                    if previous_default:
                        app.evaluate(
                            f"fetch({json.dumps(api + '/providers/default')},{{method:'PUT',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{providerId:{json.dumps(previous_default)}}})}})"
                        )
                    current_default = app.evaluate(
                        f"fetch({json.dumps(api + '/providers/default')}).then(r=>r.json()).then(x=>x.provider?.id||null)"
                    )
                if current_default != previous_default:
                    cleanup_errors.append(
                        f"provider default mismatch after cleanup: expected {previous_default!r}, got {current_default!r}"
                    )
            except Exception as error:
                cleanup_errors.append(f"provider default verification failed: {error}")

        cancel_release.set()
        for server_name, server in (("fixture", fixture_server), ("provider", model_server)):
            try:
                server.shutdown()
            except Exception as error:
                cleanup_errors.append(f"{server_name} server shutdown failed: {error}")
            try:
                server.server_close()
            except Exception as error:
                cleanup_errors.append(f"{server_name} server close failed: {error}")
        for worker in workers:
            try:
                worker.join(timeout=3)
                if worker.is_alive():
                    cleanup_errors.append("fixture HTTP worker did not stop")
            except Exception as error:
                cleanup_errors.append(f"fixture HTTP worker join failed: {error}")

        if app:
            try:
                app.ws.close()
            except Exception as error:
                cleanup_errors.append(f"app websocket close failed: {error}")

        if cleanup_errors:
            raise RuntimeError("cleanup failed: " + "; ".join(cleanup_errors))

    if success_report is None:
        raise RuntimeError("smoke finished without a success report")
    success_report["provider_default_before_fixture"] = previous_default
    success_report["provider_default_restored_and_verified"] = True
    success_report["fixture_tabs_removed"] = True
    success_report["fixture_servers_stopped"] = True
    print(json.dumps(success_report, indent=2))
    return 0


def _selected_urls(context: dict | None) -> list[str]:
    if not isinstance(context, dict):
        return []
    return [
        tab["url"]
        for tab in context.get("selectedTabs", [])
        if isinstance(tab, dict) and isinstance(tab.get("url"), str)
    ]


def _remove_attachment(cdp: CDP, title: str) -> None:
    removed = cdp.evaluate(
        "(()=>{for(const button of document.querySelectorAll('button[title=\"Remove tab\"]')){"
        "let node=button;for(let depth=0;node&&depth<6;depth++,node=node.parentElement){"
        "if((node.innerText||'').includes(" + json.dumps(title) + ")){button.click();return true}}}"
        "return false})()"
    )
    if removed is not True:
        return


def _select_page(cdp: CDP, title: str) -> None:
    dialog_open = cdp.evaluate("!!document.querySelector('[role=dialog] [data-mention-item]')")
    if not dialog_open:
        cdp.evaluate("document.querySelector('button[data-tab-mention-trigger]')?.click()")
    wait_js(cdp, "!!document.querySelector('[role=dialog] [data-mention-item]')")
    selected = cdp.evaluate(
        "(()=>{const item=[...document.querySelectorAll('[role=dialog] [data-mention-item]')]"
        " .find(e=>e.innerText.includes(" + json.dumps(title) + "));"
        "if(!item)return false;item.click();return true})()"
    )
    if selected is not True:
        raise AssertionError(f"visible tab picker did not list {title!r}")


if __name__ == "__main__":
    raise SystemExit(main())
