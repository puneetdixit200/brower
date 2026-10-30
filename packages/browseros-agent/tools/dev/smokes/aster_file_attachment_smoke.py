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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
import tempfile
import threading
import time
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
    prompt = "Read the attached fixture and report its receipt status."
    followup_prompt = "Answer this follow-up without using another file."
    response_texts = [
        "Aster local fixture provider acknowledged turn one.",
        "Aster local fixture provider acknowledged turn two.",
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

    with tempfile.TemporaryDirectory(prefix="aster-file-smoke-") as tmp:
        file_path = Path(tmp) / filename
        file_path.write_text(f"Synthetic file receipt marker: {marker}\n", encoding="utf-8")

        target = wait_target(cdp_base, "#/home")
        cdp = CDP(target["webSocketDebuggerUrl"])
        previous_default_id: str | None = None
        try:
            cdp.call("Runtime.enable")
            cdp.call("DOM.enable")
            cdp.evaluate("location.hash='/home'")
            wait_for(cdp, "location.hash.endsWith('/home')")
            wait_for(
                cdp,
                f"fetch({json.dumps(server_base + '/system/health')}).then(r=>r.ok).catch(()=>false)",
                timeout=45,
            )

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

            print(
                json.dumps(
                    {
                        "browseros_file_attach_remove_submit": "passed",
                        "request_body_file_marker": "observed",
                        "local_provider_file_marker": "observed",
                        "local_provider_response": "turn_one_received",
                        "turn_two_prior_file_marker": "absent_from_chat_and_model_request",
                        "turn_two_local_provider_response": "received",
                        "page_and_chat_url_leak": "none",
                        "synthetic_fixture": filename,
                    }
                )
            )
            return 0
        finally:
            # Always best-effort delete this fresh UUID, including when the
            # PUT reached the sidecar but its response was lost.
            try:
                cleanup_temporary_provider(
                    cdp, server_base, provider_id, previous_default_id
                )
            except Exception as exc:
                print(f"provider cleanup failed: {exc}", file=sys.stderr)
                raise
            provider_server.shutdown()
            provider_server.server_close()
            cdp.ws.close()


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


def click_send(cdp: CDP) -> None:
    button = "document.querySelector('textarea')?.closest('form')?.querySelector('button[type=submit]')||document.querySelector('textarea')?.closest('div.flex.gap-3')?.querySelector('button:last-child')"
    wait_for(cdp, f"(()=>{{const button={button};return !!button&&!button.disabled}})()")
    result = cdp.evaluate(f"(()=>{{const button={button};if(!button)throw Error('Send button missing');button.click();return true}})()")
    if result is not True:
        raise RuntimeError("could not submit the composer")


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
