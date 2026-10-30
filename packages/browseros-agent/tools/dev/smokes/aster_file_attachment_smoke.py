#!/usr/bin/env python3
"""Exercise file attach/remove/submit in a disposable headed BrowserOS run.

Requires the Linux dev runner with a temporary profile and a local sidecar.
Only a synthetic text fixture is uploaded. The smoke checks the actual
extension-to-sidecar request body and the deterministic mock chat response.
"""

from __future__ import annotations

import argparse
import atexit
import base64
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(REPO_ROOT / "tests" / "e2e"))
from aster_ui_latency_benchmark import CDP  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--server-port", type=int, required=True)
    args = parser.parse_args()

    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    server_base = f"http://127.0.0.1:{args.server_port}"
    provider_id = f"aster-file-smoke-{uuid.uuid4()}"
    marker = f"ASTER_FILE_RECEIPT_{uuid.uuid4().hex}"
    filename = f"aster-file-receipt-{uuid.uuid4().hex[:8]}.txt"
    history_nonce = uuid.uuid4().hex
    history_query = f"ASTER_HISTORY_SYNTHETIC_{history_nonce}"
    selected_title = f"{history_query}_SELECTED_TITLE"
    unselected_title = f"{history_query}_UNSELECTED_TITLE"
    selected_path = f"/aster-selected-path-{history_nonce}"
    unselected_path = f"/aster-unselected-path-{history_nonce}"
    selected_query_secret = f"selected-query-{history_nonce}"
    unselected_query_secret = f"unselected-query-{history_nonce}"
    selected_hash_secret = f"selected-hash-{history_nonce}"
    unselected_hash_secret = f"unselected-hash-{history_nonce}"
    prompt = "Read the attached fixture and report its receipt status."
    followup_prompt = "Answer this follow-up without using another file."
    response_texts = [
        "Aster local fixture provider acknowledged turn one.",
        "Aster local fixture provider acknowledged turn two.",
        "Aster local fixture provider acknowledged NewTabChat submission.",
    ]

    class FixtureProvider(ThreadingHTTPServer):
        requests: list[dict] = []

    class ProviderHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0"))
            FixtureProvider.requests.append(json.loads(self.rfile.read(length)))
            response_text = response_texts[
                min(len(FixtureProvider.requests) - 1, len(response_texts) - 1)
            ]
            chunks = [
                {
                    "id": "aster-local-fixture",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "aster-test-mock",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "content": response_text},
                            "finish_reason": None,
                        }
                    ],
                },
                {
                    "id": "aster-local-fixture",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "aster-test-mock",
                    "choices": [
                        {"index": 0, "delta": {}, "finish_reason": "stop"}
                    ],
                },
            ]
            payload = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
            payload += "data: [DONE]\n\n"
            encoded = payload.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    provider_server = FixtureProvider(("127.0.0.1", 0), ProviderHandler)
    provider_port = provider_server.server_address[1]
    provider_thread = threading.Thread(target=provider_server.serve_forever, daemon=True)
    provider_thread.start()
    atexit.register(provider_server.shutdown)

    class HistoryFixture(ThreadingHTTPServer):
        pass

    class HistoryHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            title = selected_title if self.path.startswith(selected_path) else unselected_title
            page = (
                "<!doctype html><meta charset=utf-8><title>"
                + title
                + "</title><p>Synthetic local history fixture.</p>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    history_server = HistoryFixture(("127.0.0.1", 0), HistoryHandler)
    history_port = history_server.server_address[1]
    history_thread = threading.Thread(target=history_server.serve_forever, daemon=True)
    history_thread.start()

    with tempfile.TemporaryDirectory(prefix="aster-file-smoke-") as tmp:
        file_path = Path(tmp) / filename
        file_path.write_text(f"Synthetic file receipt marker: {marker}\n", encoding="utf-8")

        cdp: CDP | None = None
        previous_default_id: str | None = None
        try:
            target = wait_target(cdp_base, "#/home")
            cdp = CDP(target["webSocketDebuggerUrl"])
            cdp.call("Runtime.enable")
            cdp.call("DOM.enable")
            cdp.evaluate("location.hash='/home'")
            wait_for(cdp, "location.hash.endsWith('/home')")
            wait_for(
                cdp,
                f"fetch({json.dumps(server_base + '/system/health')}).then(r=>r.ok).catch(()=>false)",
                timeout=45,
            )

            selected_url = (
                f"http://127.0.0.1:{history_port}{selected_path}"
                f"?{selected_query_secret}#${selected_hash_secret}"
            )
            unselected_url = (
                f"http://127.0.0.1:{history_port}{unselected_path}"
                f"?{unselected_query_secret}#${unselected_hash_secret}"
            )
            seed_history_page(cdp_base, selected_url, selected_title)
            seed_history_page(cdp_base, unselected_url, unselected_title)

            previous_default_id = get_default_provider_id(cdp, server_base)
            saved_status = save_temporary_provider(
                cdp, server_base, provider_id, provider_port
            )
            provider_saved = saved_status == 200
            selected_status = (
                select_temporary_provider(cdp, server_base, provider_id)
                if provider_saved
                else None
            )
            configured = {"saved": saved_status, "selected": selected_status}
            if configured != {"saved": 200, "selected": 200}:
                raise RuntimeError(f"could not configure local mock provider: {configured}")
            cdp.evaluate("location.reload()")
            wait_for(cdp, "document.body.innerText.includes('Aster File Fixture Provider')")

            # Use the visible Home composer history picker after the provider
            # setup reload so its React selection remains active for the send.
            cdp.evaluate(
                "document.querySelector('button[aria-label=\"Attach browser history\"]')?.click()"
            )
            wait_for(cdp, "!!document.querySelector('input[aria-label=\"Search browser history\"]')")
            set_input_value(cdp, 'input[aria-label="Search browser history"]', history_query)
            cdp.evaluate("document.querySelector('button[aria-label=\"Search history\"]')?.click()")
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(selected_title)})")
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(unselected_title)})")
            cdp.evaluate(
                "(()=>{const row=Array.from(document.querySelectorAll('p')).find(e=>e.textContent==="
                + json.dumps(selected_title)
                + ");const button=row?.parentElement?.querySelector('button');if(!button)throw Error('selected history row button missing');button.click();return true})()"
            )
            wait_for(cdp, f"document.body.innerText.includes({json.dumps('History: ' + selected_title)})")
            selected_history_count = cdp.evaluate(
                "Array.from(document.querySelectorAll('button[aria-label=\"Remove browser history\"]')).length"
            )
            if selected_history_count != 1:
                raise AssertionError(
                    f"expected one selected history item, found {selected_history_count}"
                )
            cdp.evaluate(
                "document.querySelector('button[aria-label=\"Attach browser history\"]')?.click()"
            )

            set_file_input(cdp, str(file_path))
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(filename)})")
            cdp.evaluate(
                "document.querySelector("
                + json.dumps(f'button[aria-label="Remove {filename}"]')
                + ")?.click()"
            )
            wait_for(cdp, f"!document.body.innerText.includes({json.dumps(filename)})")

            # The composer clears the native input after staging, so the same
            # synthetic file can be selected again after removal.
            set_file_input(cdp, str(file_path))
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(filename)})")
            cdp.evaluate(
                "(()=>{const original=window.fetch.bind(window);window.__asterChatRequests=[];"
                "window.fetch=(input,init={})=>{const url=typeof input==='string'?input:input.url;"
                "if(url.endsWith('/chat'))window.__asterChatRequests.push({url,body:init.body||''});"
                "return original(input,init)}})()"
            )
            set_textarea(cdp, prompt)
            click_send(cdp)
            wait_for(
                cdp,
                f"document.body.innerText.includes({json.dumps(response_texts[0])})",
                timeout=60,
            )
            request = cdp.evaluate("window.__asterChatRequests[0]")
            if not request or not request.get("url", "").endswith("/chat"):
                raise AssertionError("the extension did not submit a chat request")
            if marker in request["url"] or filename in request["url"]:
                raise AssertionError("file content or filename leaked into the chat request URL")
            if not FixtureProvider.requests:
                raise AssertionError("local provider did not receive a model request")
            if not request_contains_marker(FixtureProvider.requests[-1], marker):
                raise AssertionError("local provider request did not contain the selected file content")
            provider_request_json = json.dumps(FixtureProvider.requests[0], ensure_ascii=False)
            if provider_request_json.count(selected_title) != 1:
                raise AssertionError(
                    "selected history title did not reach the provider exactly once; "
                    f"provider messages={FixtureProvider.requests[0].get('messages', [])!r}"
                )
            selected_origin = f"http://127.0.0.1:{history_port}"
            if provider_request_json.count(selected_origin) != 1:
                raise AssertionError("selected history origin did not reach the provider exactly once")
            forbidden_history_values = (
                unselected_title,
                selected_path,
                unselected_path,
                selected_query_secret,
                unselected_query_secret,
                selected_hash_secret,
                unselected_hash_secret,
            )
            forbidden_route_values = (
                selected_title,
                unselected_title,
                selected_origin,
                selected_path,
                unselected_path,
                selected_query_secret,
                unselected_query_secret,
                selected_hash_secret,
                unselected_hash_secret,
            )
            for forbidden in forbidden_history_values:
                if forbidden in provider_request_json:
                    raise AssertionError(
                        f"unselected history or full URL component reached provider: {forbidden}"
                    )
            if selected_title not in json.dumps(request.get("body", ""), ensure_ascii=False):
                raise AssertionError("selected history title was absent from the /chat body")
            for candidate in forbidden_route_values:
                if candidate in request.get("url", "") or candidate in cdp.evaluate("location.href"):
                    raise AssertionError("history content or full URL component leaked into a route URL")
            try:
                body = json.loads(request.get("body", ""))
                attachment_data = body["attachments"][0]["data"]
                encoded = attachment_data.split(",", 1)[1]
                decoded_attachment = base64.b64decode(encoded).decode("utf-8")
            except (KeyError, IndexError, ValueError, UnicodeDecodeError) as exc:
                raise AssertionError("submitted request did not contain a readable file attachment") from exc
            if marker not in decoded_attachment:
                raise AssertionError("selected file content was absent from the /chat request body")

            # The completed transcript retains the file for display, but a
            # new text-only turn must not replay the prior turn's bytes.
            set_textarea(cdp, followup_prompt)
            click_send(cdp)
            wait_for(
                cdp,
                f"document.body.innerText.includes({json.dumps(response_texts[1])})",
                timeout=60,
            )
            wait_for(cdp, "window.__asterChatRequests.length >= 2")
            if len(FixtureProvider.requests) != 2:
                raise AssertionError(
                    f"expected exactly two local model requests, got {len(FixtureProvider.requests)}"
                )
            second_chat_request = cdp.evaluate("window.__asterChatRequests[1]")
            if not second_chat_request or not second_chat_request.get("url", "").endswith("/chat"):
                raise AssertionError("the extension did not submit the second chat request")
            if marker in second_chat_request["url"] or filename in second_chat_request["url"]:
                raise AssertionError("turn-one file content or filename leaked into turn-two /chat URL")
            second_chat_body = second_chat_request.get("body", "")
            if marker in second_chat_body or filename in second_chat_body:
                raise AssertionError("turn-one file content or filename leaked into turn-two /chat body")
            try:
                parsed_second_chat_body = json.loads(second_chat_body)
            except (TypeError, ValueError) as exc:
                raise AssertionError("second /chat request body was not JSON") from exc
            if followup_prompt not in json.dumps(parsed_second_chat_body, ensure_ascii=False):
                raise AssertionError("turn-two follow-up prompt was absent from the /chat body")
            if parsed_second_chat_body.get("attachments"):
                raise AssertionError("turn two unexpectedly submitted an attachment")
            second_provider_request = FixtureProvider.requests[1]
            if followup_prompt not in json.dumps(second_provider_request, ensure_ascii=False):
                raise AssertionError("turn-two prompt was absent from the second local model request")
            if request_contains_marker(second_provider_request, marker):
                raise AssertionError("turn-one file content was replayed in the turn-two model request")
            if filename in json.dumps(second_provider_request, ensure_ascii=False):
                raise AssertionError("turn-one filename was replayed in the turn-two model request")
            current_url = cdp.evaluate("location.href")
            if marker in current_url or filename in current_url:
                raise AssertionError("file content or filename leaked into the chat URL")

            # Exercise the persistent NewTabChat composer, mounted by the
            # extension hash route #/home/chat. Staging stays local until the
            # user explicitly submits the form.
            cdp.evaluate("window.__asterChatRequests=[];location.hash='/home/chat'")
            wait_for(cdp, "location.hash.endsWith('/home/chat')")
            wait_for(cdp, "!!document.querySelector('textarea')")
            set_file_input(cdp, str(file_path))
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(filename)})")
            assert_no_newtab_submission(cdp, FixtureProvider.requests, "initial stage")
            cdp.evaluate(
                "document.querySelector("
                + json.dumps(f'button[aria-label="Remove {filename}"]')
                + ")?.click()"
            )
            wait_for(cdp, f"!document.body.innerText.includes({json.dumps(filename)})")
            assert_no_newtab_submission(cdp, FixtureProvider.requests, "remove")
            set_file_input(cdp, str(file_path))
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(filename)})")
            assert_no_newtab_submission(cdp, FixtureProvider.requests, "reattach")
            set_textarea(cdp, "Read the attached fixture in the persistent new-tab composer.")
            click_send(cdp)
            wait_for(cdp, "window.__asterChatRequests.length === 1", timeout=60)
            wait_for(
                cdp,
                f"document.body.innerText.includes({json.dumps(response_texts[2])})",
                timeout=60,
            )
            newtab_chat_request = cdp.evaluate("window.__asterChatRequests[0]")
            if not newtab_chat_request or not newtab_chat_request.get("url", "").endswith("/chat"):
                raise AssertionError("NewTabChat did not submit through /chat")
            newtab_page_url = cdp.evaluate("location.href")
            if any(
                value in newtab_page_url or value in newtab_chat_request["url"]
                for value in (marker, filename)
            ):
                raise AssertionError("NewTabChat leaked file content or filename into a URL")
            try:
                newtab_chat_body = json.loads(newtab_chat_request.get("body", ""))
            except (TypeError, ValueError) as exc:
                raise AssertionError("NewTabChat /chat request body was not JSON") from exc
            if "Read the attached fixture in the persistent new-tab composer." not in json.dumps(
                newtab_chat_body, ensure_ascii=False
            ):
                raise AssertionError("NewTabChat prompt was absent from the /chat body")
            if len(newtab_chat_body.get("attachments", [])) != 1:
                raise AssertionError("NewTabChat did not submit exactly one selected attachment")
            if count_marker(newtab_chat_body["attachments"], marker) != 1:
                raise AssertionError("NewTabChat /chat attachment did not contain exactly one marker")
            if len(FixtureProvider.requests) != 3:
                raise AssertionError(
                    f"expected exactly three local model requests, got {len(FixtureProvider.requests)}"
                )
            if count_marker(FixtureProvider.requests[2], marker) != 1:
                raise AssertionError(
                    "NewTabChat provider request did not contain exactly one file marker"
                )

            print(
                json.dumps(
                    {
                        "browseros_file_attach_remove_submit": "passed",
                        "request_body_file_marker": "observed",
                        "local_provider_file_marker": "observed",
                        "local_provider_response": "turn_one_received",
                        "selected_history_provider_receipt": "selected_title_and_origin_once",
                        "unselected_history_and_full_urls": "absent_from_provider_and_route_url",
                        "selected_history_title": selected_title,
                        "selected_history_origin": selected_origin,
                        "unselected_history_title": unselected_title,
                        "turn_two_prior_file_marker": "absent_from_chat_and_model_request",
                        "turn_two_local_provider_response": "received",
                        "page_and_chat_url_leak": "none",
                        "newtab_chat_attach_remove_explicit_submit": "passed",
                        "newtab_chat_marker_in_chat_and_provider": "observed",
                        "synthetic_fixture": filename,
                    }
                )
            )
            return 0
        finally:
            # Always best-effort delete this fresh UUID, including when the
            # PUT reached the sidecar but its response was lost.

            def cleanup_provider() -> None:
                if cdp is not None:
                    cleanup_temporary_provider(
                        cdp, server_base, provider_id, previous_default_id
                    )

            cleanup_with_resources(
                cleanup_provider,
                [
                    ("provider server shutdown", provider_server.shutdown),
                    ("provider server close", provider_server.server_close),
                    ("history server shutdown", history_server.shutdown),
                    ("history server close", history_server.server_close),
                    (
                        "CDP websocket close",
                        lambda: cdp.ws.close() if cdp is not None else None,
                    ),
                ],
            )


def get_default_provider_id(cdp: CDP, server_base: str) -> str | None:
    result = cdp.evaluate(
        "(async({serverBase})=>{const r=await fetch(`${serverBase}/providers/default`);"
        "if(!r.ok)return {status:r.status};const body=await r.json();"
        "return {status:r.status,providerId:body.provider?.id??null}})({serverBase:"
        + json.dumps(server_base)
        + "})"
    )
    if result.get("status") != 200:
        raise RuntimeError(f"could not inspect previous default provider: {result}")
    return result.get("providerId")


def save_temporary_provider(
    cdp: CDP, server_base: str, provider_id: str, provider_port: int
) -> int:
    result = cdp.evaluate(
        "(async({providerId,serverBase,providerPort})=>{"
        "const p={type:'openai-compatible',name:'Aster File Fixture Provider',"
        "baseUrl:`http://127.0.0.1:${providerPort}/v1`,modelId:'aster-test-mock',"
        "supportsImages:false,contextWindow:32000,temperature:0.2,"
        "apiKey:'test-only-dummy',createdAt:Date.now()};"
        "const saved=await fetch(`${serverBase}/providers/${providerId}`,"
        "{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});"
        "return {status:saved.status}})({providerId:"
        + json.dumps(provider_id)
        + ",serverBase:"
        + json.dumps(server_base)
        + ",providerPort:"
        + str(provider_port)
        + "})"
    )
    return result.get("status", 0)


def select_temporary_provider(cdp: CDP, server_base: str, provider_id: str) -> int:
    result = cdp.evaluate(
        "(async({serverBase,providerId})=>{const selected=await fetch("
        "`${serverBase}/providers/default`,{method:'PUT',"
        "headers:{'Content-Type':'application/json'},"
        "body:JSON.stringify({providerId})});return {status:selected.status}})({serverBase:"
        + json.dumps(server_base)
        + ",providerId:"
        + json.dumps(provider_id)
        + "})"
    )
    return result.get("status", 0)


def cleanup_temporary_provider(
    cdp: CDP,
    server_base: str,
    provider_id: str,
    previous_default_id: str | None,
) -> None:
    errors: list[str] = []
    if previous_default_id:
        restored = cdp.evaluate(
            "(async({serverBase,providerId})=>{const response=await fetch("
            "`${serverBase}/providers/default`,{method:'PUT',"
            "headers:{'Content-Type':'application/json'},"
            "body:JSON.stringify({providerId})});return {status:response.status}})({serverBase:"
            + json.dumps(server_base)
            + ",providerId:"
            + json.dumps(previous_default_id)
            + "})"
        )
        if restored != {"status": 200}:
            errors.append(f"failed to restore previous default provider: {restored}")

    deleted = cdp.evaluate(
        "(async({serverBase,providerId})=>{const response=await fetch("
        "`${serverBase}/providers/${providerId}`,{method:'DELETE'});"
        "return {status:response.status}})({serverBase:"
        + json.dumps(server_base)
        + ",providerId:"
        + json.dumps(provider_id)
        + "})"
    )
    if deleted not in ({"status": 200}, {"status": 404}):
        errors.append(f"failed to remove temporary provider: {deleted}")
    if errors:
        raise RuntimeError("; ".join(errors))


def cleanup_with_resources(
    primary_cleanup: Callable[[], None],
    resource_cleanups: list[tuple[str, Callable[[], None]]],
) -> None:
    primary_error: Exception | None = None
    primary_traceback = None
    try:
        primary_cleanup()
    except Exception as exc:
        primary_error = exc
        primary_traceback = exc.__traceback__

    resource_errors: list[tuple[str, Exception]] = []
    for name, cleanup in resource_cleanups:
        try:
            cleanup()
        except Exception as exc:
            resource_errors.append((name, exc))

    if primary_error is not None:
        for name, error in resource_errors:
            print(f"additional cleanup failed ({name}): {error}", file=sys.stderr)
        raise primary_error.with_traceback(primary_traceback)
    if resource_errors:
        details = "; ".join(f"{name}: {error}" for name, error in resource_errors)
        raise RuntimeError(f"resource cleanup failed: {details}") from resource_errors[0][1]


def set_file_input(cdp: CDP, file_path: str) -> None:
    root = cdp.call("DOM.getDocument")["root"]["nodeId"]
    node = cdp.call(
        "DOM.querySelector", {"nodeId": root, "selector": "input[type=file]"}
    ).get("nodeId")
    if not node:
        raise RuntimeError("composer file input was not found")
    cdp.call("DOM.setFileInputFiles", {"files": [file_path], "nodeId": node})


def set_textarea(cdp: CDP, value: str) -> None:
    cdp.evaluate(
        "(()=>{const e=document.querySelector('textarea');if(!e)throw Error('composer textarea missing');"
        "const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;"
        "set.call(e,"
        + json.dumps(value)
        + ");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
    )


def set_input_value(cdp: CDP, selector: str, value: str) -> None:
    cdp.evaluate(
        "(()=>{const e=document.querySelector(" + json.dumps(selector) + ");"
        "if(!e)throw Error('input missing: '+" + json.dumps(selector) + ");"
        "const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"
        "set.call(e," + json.dumps(value) + ");"
        "e.dispatchEvent(new Event('input',{bubbles:true}));"
        "e.dispatchEvent(new Event('change',{bubbles:true}));return true})()"
    )


def seed_history_page(cdp_base: str, url: str, expected_title: str) -> None:
    request = urllib.request.Request(
        f"{cdp_base}/json/new?{urllib.parse.quote(url, safe='')}", method="PUT"
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        target = json.load(response)
    page_cdp: CDP | None = None
    try:
        page_cdp = CDP(target["webSocketDebuggerUrl"])
        page_cdp.call("Page.enable")
        page_cdp.call("Page.navigate", {"url": url})
        wait_for(page_cdp, f"document.title === {json.dumps(expected_title)}", timeout=15)
    finally:
        try:
            if page_cdp is not None:
                page_cdp.ws.close()
        finally:
            close_request = urllib.request.Request(
                f"{cdp_base}/json/close/{target['id']}"
            )
            with urllib.request.urlopen(close_request, timeout=5):
                pass


def click_send(cdp: CDP) -> None:
    button = "document.querySelector('textarea')?.closest('form')?.querySelector('button[type=submit]')||document.querySelector('textarea')?.closest('div.flex.gap-3')?.querySelector('button:last-child')"
    wait_for(cdp, f"(()=>{{const button={button};return !!button&&!button.disabled}})()")
    result = cdp.evaluate(f"(()=>{{const button={button};if(!button)throw Error('Send button missing');button.click();return true}})()")
    if result is not True:
        raise RuntimeError("could not submit the composer")


def assert_no_newtab_submission(
    cdp: CDP, provider_requests: list[dict], stage: str
) -> None:
    # Give queued browser/provider work a short chance to surface before
    # asserting that local staging/removal did not submit a chat turn.
    time.sleep(0.25)
    chat_requests = cdp.evaluate("window.__asterChatRequests.length")
    if chat_requests != 0:
        raise AssertionError(
            f"NewTabChat submitted during {stage}: {chat_requests} /chat requests"
        )
    if len(provider_requests) != 2:
        raise AssertionError(
            f"NewTabChat reached the local provider during {stage}: "
            f"{len(provider_requests)} requests"
        )


def request_contains_marker(value: object, marker: str) -> bool:
    if isinstance(value, str):
        if marker in value:
            return True
        if value.startswith("data:") and "," in value:
            try:
                return marker in base64.b64decode(value.split(",", 1)[1]).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                return False
        return False
    if isinstance(value, list):
        return any(request_contains_marker(item, marker) for item in value)
    if isinstance(value, dict):
        return any(request_contains_marker(item, marker) for item in value.values())
    return False


def count_marker(value: object, marker: str) -> int:
    if isinstance(value, str):
        count = value.count(marker)
        if value.startswith("data:") and "," in value:
            try:
                decoded = base64.b64decode(value.split(",", 1)[1]).decode("utf-8")
                count += decoded.count(marker)
            except (ValueError, UnicodeDecodeError):
                pass
        return count
    if isinstance(value, list):
        return sum(count_marker(item, marker) for item in value)
    if isinstance(value, dict):
        return sum(count_marker(item, marker) for item in value.values())
    return 0


def wait_target(base: str, fragment: str) -> dict:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        with urllib.request.urlopen(f"{base}/json/list", timeout=2) as response:
            targets = json.load(response)
        for target in targets:
            if target.get("type") == "page" and fragment in target.get("url", ""):
                return target
        time.sleep(0.2)
    raise TimeoutError(f"Browser target not found: {fragment}")


def wait_for(cdp: CDP, expression: str, timeout: float = 15) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression):
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for UI condition: {expression}")


if __name__ == "__main__":
    raise SystemExit(main())
