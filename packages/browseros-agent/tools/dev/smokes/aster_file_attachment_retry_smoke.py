#!/usr/bin/env python3
"""Exercise an actual headed chat retry after a local provider request failure.

Runs against the disposable Linux dev runner. The fixture provider binds only
to loopback; synthetic text files are the only attachments used.
"""

from __future__ import annotations

import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
import tempfile
import threading
import urllib.request
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
SMOKE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SMOKE_DIR))
sys.path.insert(0, str(REPO_ROOT / "tests" / "e2e"))
from aster_file_attachment_smoke import (  # noqa: E402
    cleanup_temporary_provider,
    get_default_provider_id,
    request_contains_marker,
    save_temporary_provider,
    select_temporary_provider,
    set_file_input,
    set_textarea,
    wait_for,
    wait_target,
)
from aster_ui_latency_benchmark import CDP  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--server-port", type=int, required=True)
    args = parser.parse_args()

    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    server_base = f"http://127.0.0.1:{args.server_port}"
    provider_id = f"aster-file-retry-{uuid.uuid4()}"
    active_marker = f"ASTER_RETRY_FILE_{uuid.uuid4().hex}"
    active_name = f"aster-active-{uuid.uuid4().hex[:8]}.txt"
    reply = "Aster local retry fixture provider acknowledged the active file."

    class FixtureProvider(ThreadingHTTPServer):
        requests: list[dict] = []
        active_statuses: list[int] = []
        allow_retry = False

    class ProviderHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            if self.path == "/control/allow_retry":
                FixtureProvider.allow_retry = True
                self.send_json(200, {"allow_retry": True})
                return
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            size = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(size))
            FixtureProvider.requests.append(request)
            is_active_request = request_contains_marker(request, active_marker)
            if is_active_request and not FixtureProvider.allow_retry:
                FixtureProvider.active_statuses.append(503)
                body = json.dumps({"error": {"message": "synthetic retryable provider failure"}}).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if is_active_request:
                FixtureProvider.active_statuses.append(200)
            self.send_completion()

        def send_completion(self) -> None:
            chunk = {
                "id": "aster-local-retry-fixture",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "aster-test-mock",
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": reply}, "finish_reason": None}],
            }
            end = {
                "id": "aster-local-retry-fixture",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "aster-test-mock",
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            payload = "".join(f"data: {json.dumps(item)}\n\n" for item in (chunk, end)) + "data: [DONE]\n\n"
            encoded = payload.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def send_json(self, status: int, body: dict) -> None:
            encoded = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    provider = FixtureProvider(("127.0.0.1", 0), ProviderHandler)
    provider_port = provider.server_address[1]
    provider_thread = threading.Thread(target=provider.serve_forever, daemon=True)
    provider_thread.start()

    try:
        with tempfile.TemporaryDirectory(prefix="aster-file-retry-smoke-") as tmp:
            active_path = Path(tmp) / active_name
            active_path.write_text(f"Synthetic active-turn marker: {active_marker}\n", encoding="utf-8")

            target = wait_target(cdp_base, "#/home")
            cdp = CDP(target["webSocketDebuggerUrl"])
            previous_default_id: str | None = None
            try:
                cdp.call("Runtime.enable")
                cdp.call("DOM.enable")
                cdp.evaluate("location.hash='/home'")
                wait_for(cdp, "location.hash.endsWith('/home')")
                wait_for(cdp, f"fetch({json.dumps(server_base + '/system/health')}).then(r=>r.ok).catch(()=>false)", timeout=45)

                previous_default_id = get_default_provider_id(cdp, server_base)
                saved = save_temporary_provider(cdp, server_base, provider_id, provider_port)
                selected = select_temporary_provider(cdp, server_base, provider_id) if saved == 200 else None
                if (saved, selected) != (200, 200):
                    raise RuntimeError(f"could not configure local retry provider: saved={saved}, selected={selected}")

                cdp.evaluate("location.reload()")
                wait_for(cdp, "document.body.innerText.includes('Aster File Fixture Provider')")
                cdp.evaluate(
                    "(()=>{const original=window.fetch.bind(window);window.__asterChatRequests=[];"
                    "window.fetch=(input,init={})=>{const url=typeof input==='string'?input:input.url;"
                    "if(url.endsWith('/chat'))window.__asterChatRequests.push({url,body:init.body||''});"
                    "return original(input,init)}})()"
                )

                set_file_input(cdp, str(active_path))
                wait_for(cdp, f"document.body.innerText.includes({json.dumps(active_name)})")
                set_textarea(cdp, "Read the active fixture and report its receipt status.")
                click_send(cdp)
                wait_for(cdp, "document.body.innerText.includes('Try again')", timeout=60)
                wait_for(cdp, "window.__asterChatRequests.length===1")
                if not FixtureProvider.active_statuses or any(status != 503 for status in FixtureProvider.active_statuses):
                    raise AssertionError(f"expected only provider failures before user retry, got {FixtureProvider.active_statuses}")
                failed_provider_attempts = len(FixtureProvider.active_statuses)
                set_provider_retry_mode(provider_port)
                cdp.evaluate("[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Try again')?.click()")
                wait_for(cdp, f"document.body.innerText.includes({json.dumps(reply)})", timeout=60)
                wait_for(cdp, "window.__asterChatRequests.length===2", timeout=30)

                chat_requests = cdp.evaluate("window.__asterChatRequests")
                if len(chat_requests) != 2:
                    raise AssertionError(f"expected two /chat requests (failed attempt, UI retry), got {len(chat_requests)}")
                parsed_bodies = [json.loads(item["body"]) for item in chat_requests]
                if any(not request_contains_marker(item, active_marker) for item in parsed_bodies):
                    raise AssertionError("failed or retried /chat body omitted the active-turn attachment")
                if any(marker_count(item, active_marker) != 1 for item in parsed_bodies):
                    raise AssertionError("active attachment marker was not present exactly once in both /chat bodies")
                active_provider_requests = [
                    item for item in FixtureProvider.requests if request_contains_marker(item, active_marker)
                ]
                if FixtureProvider.active_statuses[-1:] != [200]:
                    raise AssertionError(f"provider retry did not succeed after the UI action: {FixtureProvider.active_statuses}")
                if len(FixtureProvider.active_statuses) != failed_provider_attempts + 1:
                    raise AssertionError("provider attempts changed unexpectedly after switching to retry mode")
                if any(marker_count(item, active_marker) != 1 for item in active_provider_requests):
                    raise AssertionError("active attachment marker was not present exactly once in provider requests")

                print(json.dumps({
                    "headed_retry_after_provider_request_failure": "passed",
                    "actual_ui_retry_button": "clicked",
                    "chat_requests": 2,
                    "provider_sdk_automatic_503_retries": failed_provider_attempts - 1,
                    "provider_attempt_statuses": FixtureProvider.active_statuses,
                    "user_triggered_retry_success": "verified",
                    "active_marker_once_in_failed_and_retry_requests": "verified",
                    "older_attachment_replay": "not exercised in this headed journey; covered by request unit tests",
                    "synthetic_fixture": active_name,
                }))
                return 0
            finally:
                try:
                    cleanup_temporary_provider(cdp, server_base, provider_id, previous_default_id)
                finally:
                    cdp.ws.close()
    finally:
        provider.shutdown()
        provider.server_close()


def click_send(cdp: CDP) -> None:
    cdp.evaluate(
        "document.querySelector('textarea')?.closest('div.flex.gap-3')"
        "?.querySelector('button:last-child')?.click()"
    )


def set_provider_retry_mode(provider_port: int) -> None:
    request = urllib.request.Request(
        f"http://127.0.0.1:{provider_port}/control/allow_retry",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        result = json.load(response)
    if result != {"allow_retry": True}:
        raise RuntimeError(f"local provider rejected retry control: {result}")


def marker_count(value: object, marker: str) -> int:
    if isinstance(value, str):
        count = value.count(marker)
        if value.startswith("data:") and "," in value:
            try:
                count += base64.b64decode(value.split(",", 1)[1]).decode("utf-8").count(marker)
            except (ValueError, UnicodeDecodeError):
                pass
        return count
    if isinstance(value, list):
        return sum(marker_count(item, marker) for item in value)
    if isinstance(value, dict):
        return sum(marker_count(item, marker) for item in value.values())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
