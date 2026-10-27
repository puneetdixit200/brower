#!/usr/bin/env python3
"""Local-fixture smoke checks against a running BrowserOS Chromium CDP port.

The test profile must be dedicated and disposable. Only the HTTPS certificate
check contacts example.com; all forms, downloads, tabs, cookies and storage use
a loopback fixture server. No credentials or user profile data are read.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import json
import os
import secrets
import socket
import struct
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DOWNLOAD_BYTES = b"Aster Browser smoke fixture v1\n"
DOWNLOAD_SHA256 = hashlib.sha256(DOWNLOAD_BYTES).hexdigest()
BOOKMARK_URL = "http://127.0.0.1/aster-smoke-bookmark"
BOOKMARK_TITLE = "Aster browser smoke bookmark"


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    submissions: list[dict[str, str]] = []

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/download":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header(
                "Content-Disposition", 'attachment; filename="aster-smoke.txt"'
            )
            self.send_header("Content-Length", str(len(DOWNLOAD_BYTES)))
            self.end_headers()
            self.wfile.write(DOWNLOAD_BYTES)
            return

        if path == "/":
            body = b"""<!doctype html>
<meta charset=utf-8><title>Aster local browser fixture</title>
<h1 id=heading>Aster local browser fixture</h1>
<form method=post action=/submit id=smoke-form>
  <label>Fixture value <input name=fixture value=aster-smoke-value></label>
  <button id=submit type=submit>Submit local fixture</button>
</form>
<a id=download href=/download>Download known fixture</a>
<div id=scroller style="height:120px;width:300px;overflow:auto;border:1px solid">
  <div style="height:1000px">scroll target</div><span id=scroll-end>end</span>
</div>
"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/submit":
            body = b"<!doctype html><title>GET not accepted</title>"
            self.send_response(405)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        body = b"not found"
        self.send_response(404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        fields = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8"))
        row = {key: values[0] if values else "" for key, values in fields.items()}
        self.submissions.append(row)
        body = (
            "<!doctype html><meta charset=utf-8><title>Form submitted</title>"
            f"<h1 id=result>submitted:{row.get('fixture', '')}</h1>"
        ).encode()
        self.send_response(200 if path == "/submit" else 404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        return


class FixtureServer:
    def __enter__(self) -> "FixtureServer":
        FixtureHandler.submissions.clear()
        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), FixtureHandler
        )
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        return self

    def __exit__(self, *_: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class WebSocket:
    """Small RFC 6455 client sufficient for local Chrome DevTools Protocol."""

    def __init__(self, url: str):
        parsed = urllib.parse.urlsplit(url)
        self.sock = socket.create_connection((parsed.hostname or "127.0.0.1", parsed.port or 80), timeout=5)
        self.sock.settimeout(10)
        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parsed.netloc}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        response = bytearray()
        while b"\r\n\r\n" not in response:
            part = self.sock.recv(4096)
            if not part:
                raise ConnectionError("CDP websocket closed during handshake")
            response.extend(part)
        headers, _, remainder = response.partition(b"\r\n\r\n")
        if b" 101 " not in headers.splitlines()[0]:
            raise ConnectionError(f"CDP websocket handshake failed: {headers[:200]!r}")
        self.buffer = bytearray(remainder)

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def _read_exact(self, length: int) -> bytes:
        while len(self.buffer) < length:
            part = self.sock.recv(max(4096, length - len(self.buffer)))
            if not part:
                raise ConnectionError("CDP websocket closed")
            self.buffer.extend(part)
        result = bytes(self.buffer[:length])
        del self.buffer[:length]
        return result

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        mask = secrets.token_bytes(4)
        size = len(payload)
        prefix = bytes([0x80 | opcode])
        if size < 126:
            prefix += bytes([0x80 | size])
        elif size < 65536:
            prefix += bytes([0x80 | 126]) + struct.pack("!H", size)
        else:
            prefix += bytes([0x80 | 127]) + struct.pack("!Q", size)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.sock.sendall(prefix + mask + masked)

    def _read_frame(self) -> tuple[int, bytes]:
        first, second = self._read_exact(2)
        opcode = first & 0x0F
        size = second & 0x7F
        if size == 126:
            size = struct.unpack("!H", self._read_exact(2))[0]
        elif size == 127:
            size = struct.unpack("!Q", self._read_exact(8))[0]
        mask = self._read_exact(4) if second & 0x80 else b""
        payload = self._read_exact(size)
        if mask:
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        return opcode, payload

    def recv_text(self) -> str:
        fragments = bytearray()
        while True:
            opcode, payload = self._read_frame()
            if opcode == 8:
                raise ConnectionError("CDP websocket close frame")
            if opcode == 9:
                self._send_frame(10, payload)
                continue
            if opcode in (1, 0):
                fragments.extend(payload)
                if len(fragments) > 0 and opcode == 1:
                    return fragments.decode("utf-8")
                if opcode == 0:
                    return fragments.decode("utf-8")


class CDP:
    def __init__(self, url: str):
        self.ws = WebSocket(url)
        self.next_id = 0

    def close(self) -> None:
        self.ws.close()

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.next_id += 1
        request_id = self.next_id
        self.ws._send_frame(
            1,
            json.dumps(
                {"id": request_id, "method": method, "params": params or {}}
            ).encode("utf-8"),
        )
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            message = json.loads(self.ws.recv_text())
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
        raise TimeoutError(f"CDP call timed out: {method}")

    def evaluate(self, expression: str, *, await_promise: bool = False) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": True,
            },
        )
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("text", "Runtime error"))
        return result.get("result", {}).get("value")


def http_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


def wait_for(predicate, label: str, timeout: float = 12.0) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {label}")


def page_target(port: int, target_id: str) -> dict[str, Any]:
    return next(
        target
        for target in http_json(f"http://127.0.0.1:{port}/json/list")
        if target.get("id") == target_id
    )


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, default=9100)
    parser.add_argument("--download-dir", type=Path, required=True)
    parser.add_argument("--verify-persistence-only", action="store_true")
    args = parser.parse_args()
    args.download_dir.mkdir(parents=True, exist_ok=True)
    results: list[str] = []
    version = http_json(f"http://127.0.0.1:{args.cdp_port}/json/version")
    browser = CDP(version["webSocketDebuggerUrl"])
    if args.verify_persistence_only:
        try:
            extension = wait_for(
                lambda: next(
                    (
                        item
                        for item in http_json(
                            f"http://127.0.0.1:{args.cdp_port}/json/list"
                        )
                        if item.get("type") == "service_worker"
                        and item.get("url", "").endswith("/background.js")
                    ),
                    None,
                ),
                "BrowserOS extension service worker after restart",
            )
            extension_cdp = CDP(extension["webSocketDebuggerUrl"])
            try:
                bookmarks = extension_cdp.evaluate(
                    "new Promise(resolve => chrome.bookmarks.search({title:"
                    f"{json.dumps(BOOKMARK_TITLE)}"
                    "}, nodes => resolve(nodes.map(n => ({title:n.title,url:n.url})))))",
                    await_promise=True,
                )
                match = next(
                    (
                        item
                        for item in bookmarks
                        if item["title"] == BOOKMARK_TITLE
                        and item["url"].startswith("http://127.0.0.1:")
                    ),
                    None,
                )
                assert match is not None, "smoke bookmark did not survive restart"
                history = extension_cdp.evaluate(
                    "new Promise(resolve => chrome.history.search({text:"
                    f"{json.dumps('Aster local browser fixture')},maxResults:20,startTime:0"
                    "}, items => resolve(items.map(item => ({url:item.url,title:item.title})))))",
                    await_promise=True,
                )
                assert any(
                    item["url"].startswith("http://127.0.0.1:")
                    and "Aster local browser fixture" in item["title"]
                    for item in history
                ), "local fixture history did not survive restart"
                print("B06 bookmark persisted after clean restart PASS")
                print("B06 history persisted after clean restart PASS")
                print("persisted bookmark URL:", match["url"])
            finally:
                extension_cdp.close()
        finally:
            try:
                browser.call("Browser.close")
            except (ConnectionError, RuntimeError, TimeoutError):
                pass
            browser.close()
        return 0
    # Clean up only loopback test tabs left behind by an interrupted prior run.
    for old_target in http_json(f"http://127.0.0.1:{args.cdp_port}/json/list"):
        if old_target.get("type") == "page" and old_target.get("url", "").startswith(
            "http://127.0.0.1:"
        ):
            browser.call("Target.closeTarget", {"targetId": old_target["id"]})
    created_targets: list[str] = []
    created_contexts: list[str] = []
    with FixtureServer() as fixture:
        target_id = browser.call(
            "Target.createTarget", {"url": "about:blank"}
        )["targetId"]
        created_targets.append(target_id)
        try:
            target = wait_for(
                lambda: next(
                    (
                        item
                        for item in http_json(
                            f"http://127.0.0.1:{args.cdp_port}/json/list"
                        )
                        if item.get("id") == target_id
                    ),
                    None,
                ),
                "new browser tab",
            )
            page = CDP(target["webSocketDebuggerUrl"])
            page.call("Page.enable")
            page.call("Runtime.enable")

            # A clean test profile must accept a valid HTTPS certificate.
            page.call("Page.navigate", {"url": "https://example.com/"})
            state = wait_for(
                lambda: page.evaluate(
                    "JSON.stringify({url:location.href,title:document.title,"
                    "state:document.readyState,secure:isSecureContext})"
                )
                if page.evaluate("document.readyState") == "complete"
                else None,
                "valid HTTPS page",
                30,
            )
            parsed = json.loads(state)
            assert parsed["url"].startswith("https://example.com/")
            assert parsed["secure"] is True
            assert "Example Domain" in parsed["title"]
            results.append("B01 HTTPS navigation and secure context PASS")

            invalid_cert = page.call(
                "Page.navigate", {"url": "https://expired.badssl.com/"}
            )
            cert_error = invalid_cert.get("errorText", "")
            if "ERR_CERT" not in cert_error:
                cert_error = wait_for(
                    lambda: page.evaluate(
                        "document.body?.innerText || ''"
                    )
                    if page.evaluate("location.href").startswith("chrome-error://")
                    else None,
                    "invalid certificate interstitial",
                    25,
                )
            assert "ERR_CERT" in cert_error or "certificate" in cert_error.lower()
            results.append("B01 invalid HTTPS certificate rejected PASS")

            page.call("Page.navigate", {"url": fixture.base + "/"})
            wait_for(
                lambda: page.evaluate("document.title") == "Aster local browser fixture",
                "local fixture navigation",
            )
            results.append("B02 address/navigation to local fixture PASS")

            rect = json.loads(
                page.evaluate(
                    "JSON.stringify((r => ({x:r.x,y:r.y,width:r.width,height:r.height}))"
                    "(document.querySelector('#scroller').getBoundingClientRect()))"
                )
            )
            page.call(
                "Input.synthesizeScrollGesture",
                {
                    "x": rect["x"] + rect["width"] / 2,
                    "y": rect["y"] + rect["height"] / 2,
                    "yDistance": -180,
                    "speed": 800,
                },
            )
            wait_for(
                lambda: page.evaluate(
                    "document.querySelector('#scroller').scrollTop > 0"
                ),
                "synthetic scrolling",
            )
            results.append("B09 synthetic scroll input PASS (physical touchpad untested)")

            submitted = page.evaluate(
                "(() => { document.querySelector('#smoke-form').requestSubmit(); return true; })()"
            )
            assert submitted is True
            wait_for(
                lambda: page.evaluate("location.pathname") == "/submit",
                "form submission navigation",
            )
            assert page.evaluate("document.querySelector('#result')?.textContent") == (
                "submitted:aster-smoke-value"
            )
            assert FixtureHandler.submissions == [{"fixture": "aster-smoke-value"}]
            results.append("B09 local form submit PASS")

            page.call("Page.navigate", {"url": fixture.base + "/"})
            wait_for(
                lambda: page.evaluate("document.title") == "Aster local browser fixture",
                "fixture reload before download",
            )
            browser.call(
                "Browser.setDownloadBehavior",
                {"behavior": "allow", "downloadPath": str(args.download_dir)},
            )
            download_path = args.download_dir / "aster-smoke.txt"
            download_path.unlink(missing_ok=True)
            page.evaluate("document.querySelector('#download').click(); true")
            wait_for(lambda: download_path.is_file(), "download completion")
            assert hashlib.sha256(download_path.read_bytes()).hexdigest() == DOWNLOAD_SHA256
            results.append("B05 known-hash download PASS")

            page.evaluate("document.cookie='aster-smoke=normal; Path=/; SameSite=Lax'; true")
            normal_cookie = page.evaluate("document.cookie")
            assert "aster-smoke=normal" in normal_cookie
            context_id = browser.call("Target.createBrowserContext")["browserContextId"]
            created_contexts.append(context_id)
            private_target_id = browser.call(
                "Target.createTarget",
                {"url": fixture.base + "/", "browserContextId": context_id},
            )["targetId"]
            created_targets.append(private_target_id)
            private_target = wait_for(
                lambda: next(
                    (
                        item
                        for item in http_json(
                            f"http://127.0.0.1:{args.cdp_port}/json/list"
                        )
                        if item.get("id") == private_target_id
                    ),
                    None,
                ),
                "incognito context target",
            )
            private_page = CDP(private_target["webSocketDebuggerUrl"])
            private_page.call("Runtime.enable")
            wait_for(
                lambda: private_page.evaluate("document.title")
                == "Aster local browser fixture",
                "incognito fixture page",
            )
            assert "aster-smoke=normal" not in private_page.evaluate("document.cookie")
            assert private_page.evaluate(
                "localStorage.getItem('aster-smoke-marker')"
            ) is None
            results.append("B07 isolated incognito browser context PASS")
            private_page.close()
            browser.call("Target.disposeBrowserContext", {"browserContextId": context_id})

            # The release includes a browser extension with bookmarks permission.
            extension = next(
                (
                    item
                    for item in http_json(
                        f"http://127.0.0.1:{args.cdp_port}/json/list"
                    )
                    if item.get("type") == "service_worker"
                    and item.get("url", "").endswith("/background.js")
                ),
                None,
            )
            assert extension is not None, "BrowserOS extension service worker missing"
            extension_cdp = CDP(extension["webSocketDebuggerUrl"])
            try:
                api_type = extension_cdp.evaluate("typeof chrome.bookmarks")
                assert api_type == "object", f"bookmarks API unavailable: {api_type}"
                extension_cdp.evaluate(
                    "new Promise(resolve => chrome.bookmarks.search({title:"
                    f"{json.dumps(BOOKMARK_TITLE)}"
                    "}, nodes => { const ids=nodes.map(n=>n.id); let left=ids.length;"
                    "if (!left) return resolve(true); for (const id of ids) chrome.bookmarks.remove(id,()=>{if(!--left) resolve(true)}); }))",
                    await_promise=True,
                )
                created = extension_cdp.evaluate(
                    "new Promise(resolve => chrome.bookmarks.create({"
                    f"title:{json.dumps(BOOKMARK_TITLE)},url:{json.dumps(fixture.base + '/')}"
                    "}, node => resolve({id:node.id,title:node.title,url:node.url})))",
                    await_promise=True,
                )
                assert created["title"] == BOOKMARK_TITLE
                assert created["url"] == fixture.base + "/"
                result = extension_cdp.evaluate(
                    "new Promise(resolve => chrome.bookmarks.search({title:"
                    f"{json.dumps(BOOKMARK_TITLE)}"
                    "}, nodes => resolve(nodes.map(n => ({title:n.title,url:n.url})))))",
                    await_promise=True,
                )
                assert {"title": BOOKMARK_TITLE, "url": fixture.base + "/"} in result
                results.append("B06 bookmark create/search persistence API PASS")

                history = extension_cdp.evaluate(
                    "new Promise(resolve => chrome.history.search({text:"
                    f"{json.dumps(fixture.base)},maxResults:20,startTime:0"
                    "}, items => resolve(items.map(item => item.url))))",
                    await_promise=True,
                )
                assert any(url and url.startswith(fixture.base) for url in history)
                results.append("B06 browser history search PASS")

                tab_state = extension_cdp.evaluate(
                    "new Promise(resolve => chrome.tabs.create({url:'about:blank',active:false}, tab => {"
                    "const id=tab.id; chrome.tabs.update(id,{active:true,pinned:true}, pinned => {"
                    "if (chrome.runtime.lastError) { chrome.tabs.remove(id,()=>resolve({error:chrome.runtime.lastError.message})); return; }"
                    "chrome.tabs.move(id,{index:0}, moved => { const item=Array.isArray(moved)?moved[0]:moved; const state={id,active:pinned.active,pinned:pinned.pinned,index:item?.index};"
                    "chrome.tabs.remove(id,()=>resolve(state)); }); }); }))",
                    await_promise=True,
                )
                assert tab_state.get("active") is True and tab_state.get("pinned") is True
                assert tab_state.get("index") == 0
                results.append("B04 create/select/pin/move/close tab API PASS")
            finally:
                extension_cdp.close()

            page.call(
                "Page.navigate",
                {"url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
            )
            video_state = wait_for(
                lambda: page.evaluate(
                    "(() => { const v=document.querySelector('video'); return v ? "
                    "JSON.stringify({readyState:v.readyState,paused:v.paused,title:document.title}) : null; })()"
                )
                if page.evaluate("!!document.querySelector('video')")
                else None,
                "YouTube video player",
                50,
            )
            video = json.loads(video_state)
            results.append(
                "B09 YouTube player loaded: "
                + json.dumps(video, sort_keys=True)
            )

            gpu = browser.call("SystemInfo.getInfo")
            gpu_info = gpu.get("gpu", {})
            results.append(
                "B09 GPU info collected: "
                + json.dumps(
                    {
                        "devices": gpu_info.get("devices", []),
                        "featureStatus": gpu_info.get("featureStatus", {}),
                    },
                    sort_keys=True,
                )
            )
            page.close()
            browser.call("Target.closeTarget", {"targetId": target_id})
        finally:
            for context_id in created_contexts:
                try:
                    browser.call(
                        "Target.disposeBrowserContext",
                        {"browserContextId": context_id},
                    )
                except (ConnectionError, RuntimeError, TimeoutError):
                    pass
            for created_target in created_targets:
                try:
                    browser.call("Target.closeTarget", {"targetId": created_target})
                except (ConnectionError, RuntimeError, TimeoutError):
                    pass
            browser.close()

    for item in results:
        print(item)
    print(f"fixture_download_sha256={DOWNLOAD_SHA256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
