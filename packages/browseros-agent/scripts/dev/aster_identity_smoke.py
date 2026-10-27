#!/usr/bin/env python3
"""Headed Aster S05 identity and origin smoke for a disposable namespace.

Run inside the browser's network namespace, for example:
  nsenter --target "$PID" --user --net --preserve-credentials \
    python packages/browseros-agent/scripts/dev/aster_identity_smoke.py \
      --cdp-port 9483 --server-port 9079

The script reads only extension identity, manifest policy, diagnostics response
booleans, and HTTP status codes. It never prints diagnostics snapshots,
provider data, or MCP tokens.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT / "tests" / "e2e"))

from aster_ui_latency_benchmark import CDP  # noqa: E402

ASTER_ID = "oifdmombnijnaiocijiacjhajbnpdlhb"
BROWSEROS_PRIMARY_ID = "bflpfmnmnokmjhmgnolecpppdbdophmk"
BROWSEROS_REPORTER_ID = "adlpneommgkgeanpaekgoaolcpncohkf"
REPORTER_FIXTURE_VERSION = "aster-reporter-fixture/1.0.0"


def get_json(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


def wait_for(predicate, label: str, timeout: float = 20.0) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # CDP can briefly race target navigation.
            last_error = error
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for {label}") from last_error


def request_status(
    url: str,
    *,
    method: str = "GET",
    origin: str | None = None,
    body: bytes | None = None,
) -> int:
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if origin is not None:
        headers["Origin"] = origin
    request = urllib.request.Request(
        url, data=body, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def page_target(targets: list[dict[str, Any]], extension_id: str) -> dict[str, Any] | None:
    prefix = f"chrome-extension://{extension_id}/"
    return next(
        (
            target
            for target in targets
            if target.get("type") == "page"
            and target.get("url", "").startswith(prefix)
        ),
        None,
    )


def extension_metadata(cdp: CDP) -> dict[str, Any]:
    return cdp.evaluate(
        "(() => {const m=chrome.runtime.getManifest();return {"
        "id:chrome.runtime.id,name:m.name,key:m.key||null,"
        "updateUrl:m.update_url||null,"
        "external:m.externally_connectable||null,"
        "webResources:m.web_accessible_resources||null}})()"
    )


def diagnostics_summary(cdp: CDP) -> dict[str, Any]:
    return cdp.evaluate(
        "(async()=>{try{const r=await chrome.runtime.sendMessage({"
        "type:'browseros:diagnostics:get',maxAgeMs:0,timestamp:Date.now()});"
        "const s=r?.snapshot;return {received:!!s,"
        "fresh:r?.cached===false,reporter:s?.versions?.reporterExtension??null}}"
        "catch{return {received:false,fresh:false,reporter:null}}})()"
    )


def active_worker_contains_reporter_id(
    targets: list[dict[str, Any]], fixture_id: str
) -> bool:
    worker = next(
        (
            target
            for target in targets
            if target.get("type") == "service_worker"
            and target.get("url", "").startswith(f"chrome-extension://{ASTER_ID}/")
        ),
        None,
    )
    if worker is None:
        raise RuntimeError("Aster background service worker is not active")

    cdp = CDP(worker["webSocketDebuggerUrl"])
    try:
        cdp.next_id += 1
        request_id = cdp.next_id
        cdp.ws.send(
            json.dumps(
                {"id": request_id, "method": "Debugger.enable", "params": {}}
            ).encode()
        )
        scripts: list[str] = []
        while True:
            message = json.loads(cdp.ws.recv())
            if message.get("method") == "Debugger.scriptParsed":
                params = message.get("params", {})
                if params.get("url", "").endswith("/background.js"):
                    scripts.append(params["scriptId"])
            if message.get("id") == request_id:
                break
        if not scripts:
            raise RuntimeError("Active Aster service worker background script was not found")
        source = cdp.call("Debugger.getScriptSource", {"scriptId": scripts[0]})[
            "scriptSource"
        ]
        return fixture_id in source
    finally:
        cdp.ws.close()


def probe_external_reporter(
    targets: list[dict[str, Any]],
    expected_mode: str,
    fixture_id: str,
) -> dict[str, bool]:
    target = page_target(targets, fixture_id)
    if target is None:
        raise RuntimeError("Reporter fixture CDP page was not found")
    cdp = CDP(target["webSocketDebuggerUrl"])
    try:
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        probe_url = f"chrome-extension://{fixture_id}/probe.html"

        def page_ready() -> bool:
            return bool(
                cdp.evaluate(
                    "typeof chrome!=='undefined' && chrome.runtime?.id === "
                    + json.dumps(fixture_id)
                    + " && typeof window.probeAsterDiagnostics==='function'"
                )
            )

        ready = False
        for _attempt in range(4):
            cdp.call("Page.navigate", {"url": probe_url})
            try:
                wait_for(page_ready, "reporter fixture page registration", timeout=8)
                ready = True
                break
            except TimeoutError:
                continue
        if not ready:
            raise TimeoutError("Reporter fixture page did not load after explicit navigation")
        result = cdp.evaluate("window.probeAsterDiagnostics()")
        if expected_mode == "deny":
            if not result or result.get("response") is not None or not result.get("error"):
                raise AssertionError("Default manifest did not deny the reporter fixture")
            return {"denied": True, "allowed": False}

        response = (result or {}).get("response") or {}
        snapshot = response.get("snapshot") or {}
        received_fixture_version = (
            snapshot.get("versions", {}).get("reporterExtension")
            == REPORTER_FIXTURE_VERSION
        )
        fresh_snapshot = response.get("cached") is False
        if result.get("error") or not received_fixture_version or not fresh_snapshot:
            raise AssertionError("Configured reporter did not receive the Aster diagnostics response")
        return {"denied": False, "allowed": True, "fresh": True}
    finally:
        cdp.ws.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, default=9483)
    parser.add_argument("--server-port", type=int, default=9079)
    parser.add_argument("--probe-extension-id")
    parser.add_argument("--expect-reporter", choices=("deny", "allow"))
    args = parser.parse_args()
    if bool(args.probe_extension_id) != bool(args.expect_reporter):
        parser.error("--probe-extension-id and --expect-reporter must be supplied together")

    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    server_base = f"http://127.0.0.1:{args.server_port}"
    targets = get_json(f"{cdp_base}/json/list")
    target = page_target(targets, ASTER_ID)
    if not target or "#/home" not in target.get("url", ""):
        raise RuntimeError("Aster home extension page was not found in the headed browser")

    cdp = CDP(target["webSocketDebuggerUrl"])
    try:
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        app_url = f"chrome-extension://{ASTER_ID}/app.html#/home"
        home_ready = False
        for _attempt in range(4):
            cdp.call("Page.navigate", {"url": app_url})
            try:
                wait_for(
                    lambda: cdp.evaluate(
                        "typeof chrome!=='undefined' && "
                        f"chrome.runtime?.id==={json.dumps(ASTER_ID)} && "
                        "location.hash==='#/home' && !!document.querySelector('main') && "
                        "(!!document.querySelector('textarea') || "
                        "!!document.querySelector('input[aria-label=\"Search the web or enter an address\"]')) && "
                        "(document.body.innerText.includes('Aster Browser') || "
                        "[...document.images].some(i=>i.alt==='Aster Browser'&&i.getClientRects().length>0))"
                    ),
                    "rendered Aster home after extension startup",
                    timeout=8,
                )
                home_ready = True
                break
            except TimeoutError:
                continue
        if not home_ready:
            raise TimeoutError("Aster app page did not render after explicit navigation")

        metadata = extension_metadata(cdp)
        if metadata.get("id") != ASTER_ID:
            raise AssertionError(f"Unexpected extension runtime ID: {metadata.get('id')}")
        if not metadata.get("key"):
            raise AssertionError("Aster manifest does not contain a public key")
        key_der = base64.b64decode(metadata["key"], validate=True)
        digest = hashlib.sha256(key_der).digest()[:16]
        derived_id = "".join(f"{byte >> 4:x}{byte & 15:x}" for byte in digest)
        derived_id = "".join(chr(ord("a") + int(char, 16)) for char in derived_id)
        if derived_id != ASTER_ID:
            raise AssertionError("Manifest public key does not derive the Aster runtime ID")
        if metadata.get("name") != "Aster Browser":
            raise AssertionError("Loaded extension is not named Aster Browser")
        if metadata.get("updateUrl") is not None:
            raise AssertionError("Default development manifest has an updater URL")
        expected_external = (
            {"ids": [args.probe_extension_id]}
            if args.expect_reporter == "allow"
            else {"ids": []}
        )
        if metadata.get("external") != expected_external:
            raise AssertionError("External connection allowlist differs from the requested smoke mode")
        if metadata.get("webResources") is not None:
            raise AssertionError("Default manifest unexpectedly exposes web-accessible resources")
        if args.expect_reporter == "allow" and not active_worker_contains_reporter_id(
            get_json(f"{cdp_base}/json/list"), args.probe_extension_id
        ):
            raise AssertionError(
                "Loaded Aster worker is stale; reload the extension after rebuilding its configured manifest"
            )

        diagnostics = diagnostics_summary(cdp)
        if not diagnostics.get("received"):
            raise AssertionError("Internal diagnostics request did not return a snapshot")
        if not diagnostics.get("fresh"):
            raise AssertionError("Internal diagnostics request did not return a fresh snapshot")
        expected_reporter = (
            REPORTER_FIXTURE_VERSION if args.expect_reporter == "allow" else None
        )
        if diagnostics.get("reporter") != expected_reporter:
            raise AssertionError("Internal diagnostics reporter version differs from the expected value")

        extension_api = cdp.evaluate(
            "(async()=>{const r=await fetch(" + json.dumps(f"{server_base}/providers")
            + ");return {status:r.status,ok:r.ok}})()"
        )
        if not extension_api or extension_api.get("status") != 200:
            raise AssertionError("Aster extension page could not access the guarded providers API")
    finally:
        cdp.ws.close()

    providers_url = f"{server_base}/providers"
    origins = {
        "aster": f"chrome-extension://{ASTER_ID}",
        "browseros_primary": f"chrome-extension://{BROWSEROS_PRIMARY_ID}",
        "browseros_reporter": f"chrome-extension://{BROWSEROS_REPORTER_ID}",
        "unknown": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
    origin_statuses = {
        name: request_status(providers_url, origin=origin)
        for name, origin in origins.items()
    }
    if origin_statuses["aster"] != 200:
        raise AssertionError("Aster Origin was not admitted by the guarded API")
    if any(
        origin_statuses[name] != 403
        for name in ("browseros_primary", "browseros_reporter", "unknown")
    ):
        raise AssertionError("A BrowserOS or unknown extension Origin was not denied")

    originless_write_status = request_status(
        f"{server_base}/memory/search",
        method="POST",
        body=b'{"query":"aster identity smoke"}',
    )
    if originless_write_status != 403:
        raise AssertionError("Originless protected POST was not denied")

    external_probe = None
    if args.probe_extension_id:
        external_probe = probe_external_reporter(
            targets,
            args.expect_reporter,
            args.probe_extension_id,
        )

    print(
        json.dumps(
            {
                "ok": True,
                "extension_id": ASTER_ID,
                "derived_id_matches": True,
                "home_rendered": True,
                "diagnostics_received": True,
                "diagnostics_fresh": True,
                "reporter_version_expected": True,
                "extension_api_status": extension_api["status"],
                "origin_statuses": origin_statuses,
                "originless_protected_post_status": originless_write_status,
                "external_reporter": external_probe,
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
