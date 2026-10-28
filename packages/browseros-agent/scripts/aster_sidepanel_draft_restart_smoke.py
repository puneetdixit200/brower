#!/usr/bin/env python3
"""Verify side-panel drafts survive a full BrowserOS restart.

The smoke creates and owns a temporary profile, loads the supplied unpacked
Aster extension, and serves fixtures only on loopback. It closes and relaunches
the exact browser process group against the same profile before checking that
two owner tabs restore their own draft and attachment independently.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.server
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tests/e2e"))
from aster_ui_latency_benchmark import CDP  # noqa: E402


WAIT_SECONDS = 35.0
DEFAULT_EXTENSION_DIR = str(
    Path(__file__).resolve().parents[1] / "apps/app/dist/chrome-mv3-dev"
)


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = (
            "<!doctype html><meta charset=utf-8><title>Aster draft fixture</title>"
            f"<main>{self.path}</main>"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Exercise U15 draft restoration across a full browser process restart "
            "using a newly created temporary profile."
        )
    )
    parser.add_argument("--browser-bin", required=True, help="BrowserOS executable or AppImage")
    parser.add_argument(
        "--extension-dir",
        default=DEFAULT_EXTENSION_DIR,
        help="Unpacked Aster extension (defaults to chrome-mv3-dev)",
    )
    args = parser.parse_args()

    browser_bin = shutil.which(args.browser_bin) or os.path.abspath(args.browser_bin)
    extension_dir = os.path.abspath(args.extension_dir)
    if not os.path.isfile(browser_bin) or not os.access(browser_bin, os.X_OK):
        raise RuntimeError(f"BrowserOS binary is not executable: {browser_bin}")
    manifest = Path(extension_dir) / "manifest.json"
    if not manifest.is_file():
        raise RuntimeError(f"unpacked Aster extension manifest not found: {manifest}")
    extension_origin = extension_origin_from_bundle(extension_dir)

    fixture = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    fixture_thread = threading.Thread(target=fixture.serve_forever, daemon=True)
    fixture_thread.start()
    fixture_base = f"http://127.0.0.1:{fixture.server_port}"

    try:
        with tempfile.TemporaryDirectory(prefix="aster-u15-draft-restart-") as temp_root:
            profile_dir = os.path.join(temp_root, "profile")
            os.mkdir(profile_dir, 0o700)
            cdp_port, server_port, extension_port = reserve_ports(3)
            browser: subprocess.Popen[bytes] | None = None
            cdp: CDP | None = None
            open_panels: list[CDP] = []
            fixture_tab_ids: list[int] = []
            try:
                browser = launch_browser(
                    browser_bin,
                    profile_dir,
                    extension_dir,
                    cdp_port,
                    server_port,
                    extension_port,
                )
                cdp = connect_extension_home(cdp_port, extension_origin)
                owner_ids, attachment_ids = create_fixture_tabs(cdp, fixture_base)
                pre_restart_owner_ids = owner_ids.copy()
                fixture_tab_ids = owner_ids + attachment_ids
                drafts = [
                    f"U15 owner {index + 1} draft {owner_id}"
                    for index, owner_id in enumerate(owner_ids)
                ]

                for index, (owner_id, draft, attachment_id) in enumerate(
                    zip(owner_ids, drafts, attachment_ids, strict=True)
                ):
                    open_panel(cdp, owner_id)
                    panel = CDP(
                        wait_target(cdp_port, f"sidepanel.html?tabId={owner_id}")[
                            "webSocketDebuggerUrl"
                        ]
                    )
                    open_panels.append(panel)
                    panel.call("Runtime.enable")
                    wait_for(panel, "!!document.querySelector('textarea')")
                    attach_tab(panel, f"aster-u15-attachment-{index + 1}")
                    set_textarea(panel, draft)
                    wait_for_storage(cdp, owner_id, draft, attachment_id)
                    panel.ws.close()
                    open_panels.remove(panel)
                    close_panel(cdp, owner_id)
                    wait_no_target(cdp_port, f"sidepanel.html?tabId={owner_id}")

                # Browser.close performs the normal shutdown path so extension
                # storage and the session restore data reach disk before relaunch.
                close_browser(cdp_port, browser)
                browser = None
                cdp.ws.close()
                cdp = None

                browser = launch_browser(
                    browser_bin,
                    profile_dir,
                    extension_dir,
                    cdp_port,
                    server_port,
                    extension_port,
                )
                cdp = connect_extension_home(cdp_port, extension_origin)
                live_tabs = cdp.evaluate("(async()=>await chrome.tabs.query({}))()")
                restored_tabs = {
                    tab.get("url"): tab.get("id")
                    for tab in live_tabs
                    if tab.get("url", "").startswith(fixture_base)
                }
                expected_urls = [
                    f"{fixture_base}/owner-{index}" for index in range(1, 3)
                ] + [
                    f"{fixture_base}/aster-u15-attachment-{index}"
                    for index in range(1, 3)
                ]
                missing_urls = [url for url in expected_urls if url not in restored_tabs]
                if missing_urls:
                    raise AssertionError(
                        "Browser session restore did not restore all fixture URLs: "
                        f"missing {missing_urls}; found {sorted(restored_tabs)}. "
                        "The disposable profile may need session restore enabled."
                    )
                # Chrome tab IDs are session-scoped and can change on relaunch.
                # Resolve each owner and attachment again from its unique URL.
                owner_ids = [
                    restored_tabs[f"{fixture_base}/owner-{index}"]
                    for index in range(1, 3)
                ]
                attachment_ids = [
                    restored_tabs[f"{fixture_base}/aster-u15-attachment-{index}"]
                    for index in range(1, 3)
                ]
                fixture_tab_ids.extend(owner_ids + attachment_ids)

                restored: list[dict[str, Any]] = []
                for index, (owner_id, draft, attachment_id) in enumerate(
                    zip(owner_ids, drafts, attachment_ids, strict=True)
                ):
                    pre_restart_owner_id = pre_restart_owner_ids[index]
                    open_panel(cdp, owner_id)
                    panel = CDP(
                        wait_target(cdp_port, f"sidepanel.html?tabId={owner_id}")[
                            "webSocketDebuggerUrl"
                        ]
                    )
                    open_panels.append(panel)
                    panel.call("Runtime.enable")
                    wait_for(
                        panel,
                        "document.querySelector('textarea')?.value==="
                        + json.dumps(draft),
                        diagnostic=(
                            f"draft for pre-restart owner tab {pre_restart_owner_id} did not "
                            f"restore under post-restart tab ID {owner_id}"
                        ),
                    )
                    wait_for(
                        panel,
                        "document.querySelectorAll('footer .styled-scrollbar > div').length===1",
                    )
                    attachment_text = panel.evaluate(
                        "document.querySelector('footer .styled-scrollbar')?.innerText"
                    )
                    expected_marker = f"aster-u15-attachment-{index + 1}"
                    if expected_marker not in (attachment_text or ""):
                        raise AssertionError(
                            f"attachment for pre-restart owner tab {pre_restart_owner_id} did "
                            f"not restore under post-restart owner tab ID {owner_id} "
                            f"(expected marker {expected_marker!r}; got {attachment_text!r})"
                        )
                    restored.append(
                        {
                            "owner_tab_id": owner_ids[index],
                            "pre_restart_owner_tab_id": pre_restart_owner_id,
                            "draft": panel.evaluate(
                                "document.querySelector('textarea').value"
                            ),
                            "attachment_tab_id": attachment_ids[index],
                            "attachment_marker": expected_marker,
                        }
                    )
                    panel.ws.close()
                    open_panels.remove(panel)
                    close_panel(cdp, owner_id)
                    wait_no_target(cdp_port, f"sidepanel.html?tabId={owner_id}")

                if [row["draft"] for row in restored] != drafts:
                    raise AssertionError(f"drafts crossed owner tabs: {restored!r}")

                # Empty owner one's draft and remove its attachment. The UI's
                # storage effect should delete only that owner's record.
                open_panel(cdp, owner_ids[0])
                panel = CDP(
                    wait_target(cdp_port, f"sidepanel.html?tabId={owner_ids[0]}")[
                        "webSocketDebuggerUrl"
                    ]
                )
                open_panels.append(panel)
                panel.call("Runtime.enable")
                wait_for(
                    panel,
                    "document.querySelector('textarea')?.value==="
                    + json.dumps(drafts[0]),
                )
                panel.evaluate(
                    "(()=>{const remove=document.querySelector('footer button[title=\"Remove tab\"]');"
                    "if(!remove)throw Error('Remove tab control missing');remove.click();"
                    "const e=document.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor("
                    "HTMLTextAreaElement.prototype,'value').set;setter.call(e,'');"
                    "e.dispatchEvent(new Event('input',{bubbles:true}));})()"
                )
                wait_for_storage_absent(cdp, owner_ids[0])
                wait_for_storage(cdp, owner_ids[1], drafts[1], attachment_ids[1])

                print(
                    json.dumps(
                        {
                            "scope": "fresh temporary BrowserOS profile",
                            "same_profile_full_process_restart": "passed",
                            "per_owner_drafts_restored": 2,
                            "per_owner_attachments_restored": "passed",
                            "removing_one_owner_preserves_other": "passed",
                            "owners": restored,
                        },
                        indent=2,
                    )
                )
                return 0
            finally:
                for panel in open_panels:
                    try:
                        panel.ws.close()
                    except Exception:
                        pass
                if cdp:
                    try:
                        cleanup_fixture(cdp, fixture_tab_ids)
                    except Exception:
                        pass
                    cdp.ws.close()
                if browser:
                    stop_owned_process_group(browser)
    finally:
        fixture.shutdown()
        fixture.server_close()
        fixture_thread.join(timeout=2)


def reserve_ports(count: int) -> list[int]:
    sockets: list[socket.socket] = []
    try:
        for _ in range(count):
            sock = socket.socket()
            sock.bind(("127.0.0.1", 0))
            sockets.append(sock)
        return [int(sock.getsockname()[1]) for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def extension_origin_from_bundle(extension_dir: str) -> str:
    manifest_path = Path(extension_dir) / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        key = manifest["key"]
        digest = hashlib.sha256(base64.b64decode(key)).digest()[:16]
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f"cannot read extension identity from {manifest_path}: {error}") from error
    alphabet = "abcdefghijklmnop"
    extension_id = "".join(alphabet[value >> 4] + alphabet[value & 15] for value in digest)
    return f"chrome-extension://{extension_id}"


def launch_browser(
    browser_bin: str,
    profile_dir: str,
    extension_dir: str,
    cdp_port: int,
    server_port: int,
    extension_port: int,
) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env.update(
        {
            "BROWSEROS_CDP_PORT": str(cdp_port),
            "BROWSEROS_SERVER_PORT": str(server_port),
            "BROWSEROS_EXTENSION_PORT": str(extension_port),
            "BROWSEROS_USER_DATA_DIR": profile_dir,
            "BROWSEROS_PRODUCT": "browseros",
            "BROWSEROS_DIR": str(Path(profile_dir) / "agent-state"),
            "APPIMAGE_EXTRACT_AND_RUN": "1",
        }
    )
    command = [
        browser_bin,
        "--no-first-run",
        "--no-default-browser-check",
        "--use-mock-keychain",
        "--show-component-extension-options",
        "--disable-browseros-server",
        "--browseros-dock-icon=dev",
        "--browseros-product=browseros",
        "--disable-browseros-extensions",
        f"--remote-debugging-port={cdp_port}",
        f"--browseros-mcp-port={server_port}",
        f"--browseros-server-port={server_port}",
        f"--browseros-proxy-port={server_port}",
        f"--browseros-extension-port={extension_port}",
        f"--user-data-dir={profile_dir}",
        f"--load-extension={extension_dir}",
        "--restore-last-session",
    ]
    return subprocess.Popen(
        command,
        cwd=Path(__file__).resolve().parents[3],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def connect_extension_home(cdp_port: int, extension_origin: str) -> CDP:
    version = wait_json(f"http://127.0.0.1:{cdp_port}/json/version")
    browser_cdp = CDP(version["webSocketDebuggerUrl"])
    try:
        result = browser_cdp.call(
            "Target.createTarget", {"url": f"{extension_origin}/app.html#/home"}
        )
    finally:
        browser_cdp.ws.close()
    target = wait_target(
        cdp_port, "app.html#/home", target_id=result.get("targetId")
    )
    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    wait_for(
        cdp,
        "chrome.runtime?.id === "
        + json.dumps(extension_origin.removeprefix("chrome-extension://")),
    )
    return cdp


def create_fixture_tabs(cdp: CDP, base: str) -> tuple[list[int], list[int]]:
    tabs = cdp.evaluate(
        "(async(base)=>{const owners=[],attachments=[];for(let i=1;i<=2;i++){"
        "owners.push((await chrome.tabs.create({url:base+'/owner-'+i,active:false})).id);"
        "attachments.push((await chrome.tabs.create({url:base+'/aster-u15-attachment-'+i,"
        "active:false})).id)}return {owners,attachments}})("
        + json.dumps(base)
        + ")"
    )
    return tabs["owners"], tabs["attachments"]


def open_panel(cdp: CDP, tab_id: int) -> None:
    cdp.evaluate(
        "(async(tabId)=>{await chrome.tabs.update(tabId,{active:true});"
        "await chrome.sidePanel.setOptions({tabId,path:'sidepanel.html?tabId='+tabId,enabled:true});"
        "await chrome.sidePanel.open({tabId})})("
        + str(tab_id)
        + ")"
    )


def close_panel(cdp: CDP, tab_id: int) -> None:
    cdp.evaluate("chrome.sidePanel.close({tabId:" + str(tab_id) + "})")


def attach_tab(panel: CDP, marker: str) -> None:
    panel.evaluate("document.querySelector('[data-tab-mention-trigger]').click()")
    wait_for(panel, "!!document.querySelector('[aria-label=\"Select tabs to attach\"]')")
    panel.evaluate(
        "(()=>{const item=[...document.querySelectorAll('[data-tab-item]')].find(e=>"
        "e.innerText.includes(" + json.dumps(marker) + "));"
        "if(!item)throw Error('attachment missing from picker: "
        + marker
        + "');item.click()})()"
    )
    wait_for(
        panel,
        "!!document.querySelector('footer .styled-scrollbar')?.innerText.includes("
        + json.dumps(marker)
        + ")",
    )


def set_textarea(panel: CDP, value: str) -> None:
    panel.evaluate(
        "(()=>{const e=document.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor("
        "HTMLTextAreaElement.prototype,'value').set;setter.call(e," + json.dumps(value)
        + ");e.dispatchEvent(new Event('input',{bubbles:true}))})()"
    )


def wait_for_storage(cdp: CDP, owner_id: int, draft: str, attachment_id: int) -> None:
    wait_for(
        cdp,
        "(async()=>{const d=(await chrome.storage.local.get('sidePanelDrafts')).sidePanelDrafts;"
        "const row=d?.[String(" + str(owner_id) + ")];return row?.input==="
        + json.dumps(draft)
        + "&&row.attachedTabIds?.includes(" + str(attachment_id) + ")===true})()",
    )


def wait_for_storage_absent(cdp: CDP, owner_id: int) -> None:
    wait_for(
        cdp,
        "(async()=>!((await chrome.storage.local.get('sidePanelDrafts')).sidePanelDrafts||{})["
        + json.dumps(str(owner_id))
        + "])()",
    )


def cleanup_fixture(cdp: CDP, tab_ids: list[int]) -> None:
    if not tab_ids:
        return
    cdp.evaluate(
        "(async(ids)=>{for(const tabId of ids){await chrome.sidePanel.close({tabId}).catch(()=>{});"
        "await chrome.tabs.remove(tabId).catch(()=>{});}await new Promise(r=>setTimeout(r,250));"
        "const d=(await chrome.storage.local.get(['selectedTextMap','sidePanelDrafts']));"
        "for(const id of ids){delete d.selectedTextMap?.[String(id)];delete d.sidePanelDrafts?.[String(id)];}"
        "await chrome.storage.local.set({selectedTextMap:d.selectedTextMap||{},"
        "sidePanelDrafts:d.sidePanelDrafts||{}})})("
        + json.dumps(tab_ids)
        + ")"
    )


def wait_json(url: str) -> Any:
    deadline = time.monotonic() + WAIT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return json.load(response)
        except Exception as error:
            last_error = error
            time.sleep(0.2)
    raise TimeoutError(f"browser endpoint not ready at {url}: {last_error}")


def wait_target(cdp_port: int, fragment: str, *, target_id: str | None = None) -> dict[str, Any]:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        try:
            targets = wait_json(f"http://127.0.0.1:{cdp_port}/json/list")
            for target in targets:
                if target.get("type") != "page":
                    continue
                if target_id is not None and target.get("id") != target_id:
                    continue
                if fragment in target.get("url", ""):
                    return target
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError(f"Browser target not found: {fragment}")


def wait_no_target(cdp_port: int, fragment: str) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            targets = wait_json(f"http://127.0.0.1:{cdp_port}/json/list")
            if not any(fragment in target.get("url", "") for target in targets):
                return
        except Exception:
            return
        time.sleep(0.1)
    raise TimeoutError(f"Browser target did not close: {fragment}")


def wait_for(cdp: CDP, expression: str, *, diagnostic: str | None = None) -> None:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression):
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise TimeoutError(
        diagnostic or f"Timed out waiting for UI condition: {expression}"
    )


def close_browser(cdp_port: int, process: subprocess.Popen[bytes]) -> None:
    version = wait_json(f"http://127.0.0.1:{cdp_port}/json/version")
    browser_cdp = CDP(version["webSocketDebuggerUrl"])
    try:
        browser_cdp.call("Browser.close")
    finally:
        browser_cdp.ws.close()
    try:
        process.wait(timeout=25)
    except subprocess.TimeoutExpired:
        stop_owned_process_group(process)
        raise TimeoutError("owned BrowserOS launcher did not exit after Browser.close")
    wait_process_group_gone(process.pid, timeout=25)


def stop_owned_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        return
    os.killpg(process.pid, signal.SIGKILL)
    wait_process_group_gone(process.pid, timeout=10)


def wait_process_group_gone(pgid: int, *, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    raise TimeoutError(f"owned browser process group {pgid} did not exit")


if __name__ == "__main__":
    raise SystemExit(main())
