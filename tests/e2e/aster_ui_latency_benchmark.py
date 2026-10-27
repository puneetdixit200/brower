#!/usr/bin/env python3
"""Measure Aster home Search input response in a disposable CDP browser.

The benchmark runs entirely in the extension page and uses no network or
profile data. It measures a synthetic input event through the next animation
frame and checks that React enables the Search action. This is a UI-thread
proxy, not physical keyboard latency or proof of compositor presentation.
"""

from __future__ import annotations

import argparse
import json
import math
import socket
import statistics
import struct
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any


class WebSocket:
    def __init__(self, url: str):
        parsed = urllib.parse.urlsplit(url)
        self.sock = socket.create_connection(
            (parsed.hostname or "127.0.0.1", parsed.port or 80), timeout=5
        )
        self.sock.settimeout(10)
        key = "YXN0ZXItYmVuY2htYXJrLXdlYnNvY2tldA=="
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        self.sock.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {parsed.netloc}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode("ascii")
        )
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("CDP WebSocket closed during handshake")
            response.extend(chunk)
        headers, _, remainder = response.partition(b"\r\n\r\n")
        if b" 101 " not in headers.splitlines()[0]:
            raise ConnectionError(f"CDP handshake failed: {headers[:200]!r}")
        self.buffer = bytearray(remainder)

    def _read_exact(self, length: int) -> bytes:
        while len(self.buffer) < length:
            chunk = self.sock.recv(max(4096, length - len(self.buffer)))
            if not chunk:
                raise ConnectionError("CDP WebSocket closed")
            self.buffer.extend(chunk)
        data = bytes(self.buffer[:length])
        del self.buffer[:length]
        return data

    def send(self, payload: bytes) -> None:
        mask = b"asbr"
        size = len(payload)
        header = bytes([0x81])
        if size < 126:
            header += bytes([0x80 | size])
        elif size < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", size)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", size)
        masked = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def recv(self) -> str:
        while True:
            first, second = self._read_exact(2)
            opcode = first & 0x0F
            size = second & 0x7F
            if size == 126:
                size = struct.unpack("!H", self._read_exact(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if second & 0x80 else b""
            data = self._read_exact(size)
            if mask:
                data = bytes(value ^ mask[i % 4] for i, value in enumerate(data))
            if opcode == 8:
                raise ConnectionError("CDP WebSocket closed")
            if opcode == 9:
                self.send_control(10, data)
                continue
            if opcode in (1, 0):
                return data.decode("utf-8")

    def send_control(self, opcode: int, payload: bytes) -> None:
        mask = b"asbr"
        data = bytes(value ^ mask[i % 4] for i, value in enumerate(payload))
        self.sock.sendall(bytes([0x80 | opcode, 0x80 | len(payload)]) + mask + data)

    def close(self) -> None:
        self.sock.close()


class CDP:
    def __init__(self, url: str):
        self.ws = WebSocket(url)
        self.next_id = 0

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.next_id += 1
        request_id = self.next_id
        self.ws.send(
            json.dumps(
                {"id": request_id, "method": method, "params": params or {}}
            ).encode()
        )
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            response = json.loads(self.ws.recv())
            if response.get("id") == request_id:
                if "error" in response:
                    raise RuntimeError(f"{method}: {response['error']}")
                return response.get("result", {})
        raise TimeoutError(f"CDP call timed out: {method}")

    def evaluate(self, expression: str) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
                "userGesture": True,
            },
        )
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("text", "Runtime error"))
        return result.get("result", {}).get("value")


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--iterations", type=int, default=100)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--output", type=str)
    args = parser.parse_args()
    if args.iterations < 1 or args.warmup < 0:
        parser.error("iterations must be positive and warmup nonnegative")

    base = f"http://127.0.0.1:{args.cdp_port}"
    with urllib.request.urlopen(f"{base}/json/version", timeout=5) as response:
        version = json.load(response)
    with urllib.request.urlopen(f"{base}/json/list", timeout=5) as response:
        targets = json.load(response)
    target = next(
        (
            item
            for item in targets
            if item.get("type") == "page"
            and item.get("url", "").startswith("chrome-extension://")
            and "#/home" in item.get("url", "")
        ),
        None,
    )
    if not target:
        raise RuntimeError("Aster home target not found; open its disposable dev profile")

    cdp = CDP(target["webSocketDebuggerUrl"])
    try:
        cdp.call("Runtime.enable")
        cdp.evaluate(
            "[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.click()"
        )
        cdp.evaluate("new Promise(resolve => requestAnimationFrame(() => resolve(true)))")
        setup = cdp.evaluate(
            "(() => {"
            "const input=document.querySelector('input[aria-label=\"Search the web or enter an address\"]');"
            "const submit=document.querySelector('button[aria-label=\"Search\"]');"
            "if(!input || !submit) throw new Error('Search composer controls missing');"
            "return {mode:location.hash, input:input.getAttribute('aria-label')};"
            "})()"
        )
        if not setup:
            raise RuntimeError("Could not initialize Aster Search mode")
        samples = cdp.evaluate(
            "(async ({warmup,iterations}) => {"
            "const input=document.querySelector('input[aria-label=\"Search the web or enter an address\"]');"
            "const submit=document.querySelector('button[aria-label=\"Search\"]');"
            "const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"
            "const measure=async i => {const start=performance.now();"
            "set.call(input,'aster-latency-'+i);"
            "input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'}));"
            "await new Promise(requestAnimationFrame);const elapsed=performance.now()-start;"
            "if(submit.disabled) throw new Error('Search React state did not update');return elapsed;};"
            "for(let i=0;i<warmup;i++) await measure(-i-1);"
            "const values=[];for(let i=0;i<iterations;i++) values.push(await measure(i));return values;"
            f"}})({{warmup:{args.warmup},iterations:{args.iterations}}})"
        )
        if not isinstance(samples, list) or len(samples) != args.iterations:
            raise RuntimeError("Benchmark returned an incomplete sample set")
        result = {
            "schema": 1,
            "captured_at_utc": datetime.now(timezone.utc).isoformat(),
            "product": "Aster home Search composer",
            "browser_version": version.get("Browser"),
            "iterations": args.iterations,
            "warmup": args.warmup,
            "measurement": "input event dispatch to next animation frame with enabled Search action",
            "units": "milliseconds",
            "initial_target_ms_p95": 50,
            "within_initial_target": percentile(samples, 0.95) < 50,
            "summary": {
                "median": statistics.median(samples),
                "p95": percentile(samples, 0.95),
                "max": max(samples),
            },
            "samples": samples,
        }
        rendered = json.dumps(result, indent=2) + "\n"
        if args.output:
            with open(args.output, "w", encoding="utf-8") as file:
                file.write(rendered)
        print(rendered, end="")
        return 0
    finally:
        cdp.ws.close()


if __name__ == "__main__":
    raise SystemExit(main())
