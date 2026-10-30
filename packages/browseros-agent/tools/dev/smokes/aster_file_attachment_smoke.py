#!/usr/bin/env python3
"""Exercise file attach/remove/submit in a disposable headed BrowserOS run.

Requires the Linux dev runner with a temporary profile and a local sidecar.
Only a synthetic text fixture is uploaded. The smoke checks the actual
extension-to-sidecar request body and the deterministic mock chat response.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
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

    with tempfile.TemporaryDirectory(prefix="aster-file-smoke-") as tmp:
        file_path = Path(tmp) / filename
        file_path.write_text(f"Synthetic file receipt marker: {marker}\n", encoding="utf-8")

        target = wait_target(cdp_base, "#/home")
        cdp = CDP(target["webSocketDebuggerUrl"])
        provider_saved = False
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

            configured = cdp.evaluate(
                "(async({providerId,serverBase})=>{"
                "const p={type:'openai-compatible',name:'Aster File Fixture Mock',"
                "baseUrl:`${serverBase}/v1`,modelId:'aster-test-mock',"
                "supportsImages:false,contextWindow:32000,temperature:0.2,"
                "apiKey:'test-only-dummy',createdAt:Date.now()};"
                "const headers={'Content-Type':'application/json'};"
                "const saved=await fetch(`${serverBase}/providers/${providerId}`,"
                "{method:'PUT',headers,body:JSON.stringify(p)});"
                "if(!saved.ok)return {saved:saved.status};"
                "const selected=await fetch(`${serverBase}/providers/default`,"
                "{method:'PUT',headers,body:JSON.stringify({providerId})});"
                "return {saved:saved.status,selected:selected.status}})({providerId:"
                + json.dumps(provider_id)
                + ",serverBase:"
                + json.dumps(server_base)
                + "})"
            )
            if configured != {"saved": 200, "selected": 200}:
                raise RuntimeError(f"could not configure local mock provider: {configured}")
            provider_saved = True
            cdp.evaluate("location.reload()")
            wait_for(cdp, "document.body.innerText.includes('Aster File Fixture Mock')")

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
                "(()=>{const original=window.fetch.bind(window);window.__asterChatRequest=null;"
                "window.fetch=(input,init={})=>{const url=typeof input==='string'?input:input.url;"
                "if(url.endsWith('/chat'))window.__asterChatRequest={url,body:init.body||''};"
                "return original(input,init)}})()"
            )
            set_textarea(cdp, prompt)
            cdp.evaluate(
                "document.querySelector('textarea')?.closest('div.flex.gap-3')"
                "?.querySelector('button:last-child')?.click()"
            )
            wait_for(
                cdp,
                "document.body.innerText.includes('Mock BrowserOS test response.')",
                timeout=60,
            )
            request = cdp.evaluate("window.__asterChatRequest")
            if not request or not request.get("url", "").endswith("/chat"):
                raise AssertionError("the extension did not submit a chat request")
            if marker in request["url"] or filename in request["url"]:
                raise AssertionError("file content or filename leaked into the chat request URL")
            try:
                body = json.loads(request.get("body", ""))
                attachment_data = body["attachments"][0]["data"]
                encoded = attachment_data.split(",", 1)[1]
                decoded_attachment = base64.b64decode(encoded).decode("utf-8")
            except (KeyError, IndexError, ValueError, UnicodeDecodeError) as exc:
                raise AssertionError("submitted request did not contain a readable file attachment") from exc
            if marker not in decoded_attachment:
                raise AssertionError("selected file content was absent from the /chat request body")
            current_url = cdp.evaluate("location.href")
            if marker in current_url or filename in current_url:
                raise AssertionError("file content or filename leaked into the chat URL")

            print(
                json.dumps(
                    {
                        "browseros_file_attach_remove_submit": "passed",
                        "request_body_file_marker": "observed",
                        "mock_chat_response": "received",
                        "page_and_chat_url_leak": "none",
                        "synthetic_fixture": filename,
                    }
                )
            )
            return 0
        finally:
            if provider_saved:
                try:
                    cleanup = cdp.evaluate(
                        "(async({serverBase,providerId})=>{const response=await fetch(" 
                        "`${serverBase}/providers/${providerId}`,{method:'DELETE'});"
                        "return {status:response.status}})({serverBase:"
                        + json.dumps(server_base)
                        + ",providerId:"
                        + json.dumps(provider_id)
                        + "})"
                    )
                    if cleanup != {"status": 200}:
                        raise RuntimeError(f"failed to remove temporary provider: {cleanup}")
                except Exception as exc:
                    print(f"provider cleanup failed: {exc}", file=sys.stderr)
                    raise
            cdp.ws.close()


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
