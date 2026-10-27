#!/usr/bin/env python3
"""Exercise A05 recovery across a forced BrowserOS process crash and restart.

Use only a disposable ``run.sh --manual --new`` profile. Pass the matching
``Profile:`` path, the three ports from its ``Ports:`` line, and the exact
BrowserOS executable/AppImage selected by ``ASTER_BROWSER_BIN``.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from aster_ui_latency_benchmark import CDP


PROVIDER_NAME = "Aster A05 Crash Recovery Fixture"
DUMMY_KEY = "aster-a05-crash-smoke-dummy-only"


def main() -> int:
    parser = argparse.ArgumentParser(
        epilog=(
            "Use values from the same run.sh --manual --new session: "
            "Profile: for --profile-dir; CDP, Server, and Extension for ports; "
            "and the exact ASTER_BROWSER_BIN value for --browser-bin."
        )
    )
    parser.add_argument("--cdp-port", type=int, required=True)
    parser.add_argument("--server-port", type=int, required=True)
    parser.add_argument("--extension-port", type=int, required=True)
    parser.add_argument(
        "--profile-dir",
        required=True,
        help="Exact disposable --user-data-dir used by this BrowserOS dev run",
    )
    parser.add_argument(
        "--browser-bin",
        required=True,
        help="Exact executable/AppImage used by this BrowserOS dev run",
    )
    args = parser.parse_args()

    cdp_base = f"http://127.0.0.1:{args.cdp_port}"
    server = f"http://127.0.0.1:{args.server_port}"
    profile_dir = os.path.abspath(args.profile_dir)
    browser_bin = os.path.abspath(args.browser_bin)
    verify_profile_owner(profile_dir)
    if not os.path.isfile(browser_bin) or not os.access(browser_bin, os.X_OK):
        raise RuntimeError(f"BrowserOS binary is not an executable file: {browser_bin}")
    extension_dir = str(
        Path(__file__).resolve().parents[2]
        / "packages/browseros-agent/apps/app/dist/chrome-mv3-dev"
    )
    if not os.path.isdir(extension_dir):
        raise RuntimeError(f"development extension bundle not found: {extension_dir}")
    browser_pid = wait_for_browser_process(profile_dir, args.cdp_port, timeout=5)
    extension_origin = extension_origin_from_bundle(extension_dir)
    app_target_id = create_extension_app_target(
        cdp_base, extension_origin, timeout=30
    )
    home = wait_target_id(cdp_base, app_target_id, timeout=30)
    cdp = CDP(home["webSocketDebuggerUrl"])
    panel_cdp: CDP | None = None
    provider_id = f"aster-a05-crash-smoke-{uuid.uuid4()}"
    provider_saved = False
    previous_default_id: str | None = None
    fixture_tab_id: int | None = None
    conversation_id: str | None = None
    task_id: str | None = None
    restart_completed = False
    browser_crash_completed = False
    server_crash_sent = False
    server_pid_before_crash: int | None = None
    server_pid_after_restart: int | None = None
    server_crash_action = "not-attempted"
    prompt = f"A05 crash recovery fixture {uuid.uuid4()}"
    try:
        cdp.call("Runtime.enable")
        cdp.evaluate("location.hash = '#/home'")
        wait_for(cdp, "location.hash === '#/home'", timeout=10)
        wait_for(cdp, "document.readyState === 'complete'", timeout=10)
        wait_for_health(server, True, 45)
        provider_state = configure_provider(cdp, server, extension_origin, provider_id)
        provider_saved = provider_state["saved"]
        previous_default_id = provider_state.get("previousDefaultId")
        if not provider_state["saved"] or not provider_state["selected"]:
            raise RuntimeError(f"could not configure mock provider: {provider_state}")

        cdp.evaluate("location.reload()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(PROVIDER_NAME)})")
        fixture = cdp.evaluate(
            "(async()=>await chrome.tabs.create({url:"
            + json.dumps(server + "/system/health")
            + "}))()"
        )
        fixture_tab_id = fixture["id"]
        cdp.evaluate(
            "(async({tabId})=>{await chrome.sidePanel.setOptions({"
            "tabId,path:'sidepanel.html?tabId='+tabId,enabled:true});"
            "await chrome.sidePanel.open({tabId});return true})({tabId:"
            + str(fixture_tab_id)
            + "})"
        )
        panel = wait_target(cdp_base, f"sidepanel.html?tabId={fixture_tab_id}")
        panel_cdp = CDP(panel["webSocketDebuggerUrl"])
        panel_cdp.call("Runtime.enable")
        wait_for(panel_cdp, "!!document.querySelector('textarea')")
        panel_cdp.evaluate(set_textarea_value(prompt))
        wait_for(panel_cdp, "send button is enabled", expression=send_enabled())
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>"
            "b.textContent.trim()==='Send').click()"
        )
        wait_for(
            panel_cdp,
            "document.body.innerText.toLowerCase().includes('wait')",
            timeout=15,
        )
        wait_for(
            panel_cdp,
            "[...document.querySelectorAll('button')].some(b=>"
            "b.textContent.includes('Stop'))",
        )
        wait_for(cdp, running_wait_expression(prompt), timeout=12)
        record = cdp.evaluate(task_record_expression(prompt))
        if not record:
            raise RuntimeError("running wait task was not persisted")
        conversation_id = record["conversationId"]
        task_id = record["id"]
        state_url = f"{server}/chat/{conversation_id}/state"
        wait_for_run_status(state_url, "running", extension_origin, timeout=8)

        # Make the client disappear before crashing the server. An open
        # side panel observes the disconnect and can terminalize the task,
        # which would test client error handling rather than crash recovery.
        cdp.evaluate(
            "chrome.sidePanel.close({tabId:" + str(fixture_tab_id) + "})"
        )
        panel_cdp.ws.close()
        panel_cdp = None
        pre_shutdown_status = wait_for_task_storage_status(
            cdp, task_id, "running", timeout=5
        )
        if pre_shutdown_status != "running":
            raise RuntimeError(
                "closing the side panel changed task status before browser crash; "
                f"observed {pre_shutdown_status!r}. No recovery claim made."
            )
        wait_for_run_status(state_url, "running", extension_origin, timeout=5)

        server_sidecar = str(Path(profile_dir) / "sidecars/browseros-server.json")
        server_pid_before_crash = find_agent_server_process(server_sidecar)
        if server_pid_before_crash is None:
            raise RuntimeError(
                "could not find Bun agent-server process for the exact sidecar config "
                f"before BrowserOS crash: {server_sidecar}"
            )
        cdp.ws.close()
        terminate_browser_process(browser_pid, profile_dir, args.cdp_port)
        browser_crash_completed = True
        server_pid_after_browser_crash = find_agent_server_process(server_sidecar)
        if server_pid_after_browser_crash == server_pid_before_crash:
            terminate_agent_server_process(server_pid_before_crash, server_sidecar)
            server_crash_sent = True
            server_crash_action = "sigkill"
        else:
            state_after_browser_crash = wait_for_status(
                state_url, 404, extension_origin, timeout=8
            )
            if server_pid_after_browser_crash is None:
                server_crash_action = "already-exited-state-404"
            else:
                server_crash_action = "restarted-before-relaunch-state-404"
            if state_after_browser_crash != 404:
                raise RuntimeError(
                    "agent-server PID changed after BrowserOS crash but its run state "
                    f"was not authoritatively absent: HTTP {state_after_browser_crash}"
                )

        launch_browseros(
            browser_bin,
            profile_dir,
            extension_dir,
            args.cdp_port,
            args.server_port,
            args.extension_port,
        )
        wait_for_browser_process(
            profile_dir, args.cdp_port, timeout=45, exclude_pid=browser_pid
        )
        app_target_id = create_extension_app_target(
            cdp_base, extension_origin, timeout=30
        )
        home = wait_target_id(cdp_base, app_target_id, timeout=30)
        cdp = CDP(home["webSocketDebuggerUrl"])
        cdp.call("Runtime.enable")
        wait_for_health(server, True, 45)
        server_pid_after_restart = wait_for_agent_server_process(
            server_sidecar,
            timeout=30,
            exclude_pid=server_pid_before_crash,
        )
        run_state_status = wait_for_status(
            state_url, 404, extension_origin, timeout=8
        )
        if run_state_status != 404:
            raise RuntimeError(
                "server run state remained after sidecar recovery: "
                f"HTTP {run_state_status}"
            )
        restart_completed = True

        cdp.evaluate("location.hash = '#/tasks'")
        wait_for(cdp, "document.body.innerText.includes('Task History')")
        cdp.evaluate("location.reload()")
        wait_for(cdp, "document.body.innerText.includes('Task History')", timeout=20)
        wait_for(cdp, task_row_expression(prompt), timeout=15)
        task_state = read_task_state(cdp, conversation_id, task_id)
        stored_status = task_state["taskStatus"]
        marker_status = task_state["markerStatus"]
        if stored_status != "running" or marker_status != "interrupted":
            raise AssertionError(
                "crash recovery did not persist the expected running task plus "
                f"interrupted marker: {task_state}"
            )
        display_status = "interrupted"
        wait_for(cdp, task_status_expression(prompt, display_status), timeout=8)

        result = {
            "browser_process_crash_restart": "passed",
            "browser_process_crash_sent": browser_crash_completed,
            "browser_restart_trigger": "SIGKILL to exact BrowserOS process",
            "browser_process_pid_before_crash": browser_pid,
            "server_process_pid_before_crash": server_pid_before_crash,
            "server_process_pid_after_browser_crash_before_relaunch": server_pid_after_browser_crash,
            "server_process_sigkill_sent": server_crash_sent,
            "server_crash_action": server_crash_action,
            "server_process_pid_after_restart": server_pid_after_restart,
            "panel_closed_before_crash": True,
            "task_status_after_panel_close_before_crash": pre_shutdown_status,
            "server_run_state_after_restart_http": run_state_status,
            "persisted_task_status": stored_status,
            "persisted_recovery_marker_status": marker_status,
            "task_history_display_status": display_status,
            "tool": "local deterministic wait",
            "provider": "local mock model; dummy key only",
            "network": "loopback only",
            "browser_termination_trigger": "SIGKILL to exact BrowserOS process",
        }
        print(json.dumps(result, indent=2))
        return 0
    finally:
        try:
            usable_extension_page = cdp.evaluate(
                "typeof chrome !== 'undefined' && !!chrome.storage?.local"
            )
            if usable_extension_page is not True:
                raise RuntimeError("current CDP target is not a usable extension page")
        except Exception:
            try:
                try:
                    current_home = wait_target_id(cdp_base, app_target_id, timeout=3)
                except TimeoutError:
                    app_target_id = create_extension_app_target(
                        cdp_base, extension_origin, timeout=8
                    )
                    current_home = wait_target_id(
                        cdp_base, app_target_id, timeout=8
                    )
                cdp = CDP(current_home["webSocketDebuggerUrl"])
                cdp.call("Runtime.enable")
            except Exception:
                pass
        if conversation_id and not restart_completed:
            try:
                stop_status, stop_body = request_json(
                    f"{server}/chat/{conversation_id}/stop",
                    method="POST",
                    origin=extension_origin,
                    timeout=3,
                )
                if stop_status not in {200, 404}:
                    print(
                        "cleanup stop request did not complete: "
                        f"HTTP {stop_status} {stop_body}"
                    )
            except Exception as error:
                print(f"cleanup stop request failed: {type(error).__name__}: {error}")
        if panel_cdp:
            try:
                panel_cdp.evaluate(
                    "[...document.querySelectorAll('button')].find(b=>"
                    "b.textContent.includes('Stop'))?.click()"
                )
            except Exception:
                pass
        if panel_cdp:
            panel_cdp.ws.close()
        try:
            cdp.evaluate(cleanup_fixture_tabs(server))
            cdp.evaluate(cleanup_history(conversation_id, task_id, prompt))
        except Exception:
            pass
        if provider_saved:
            try:
                wait_for_health(server, True, 20)
                delete_provider_and_restore_default(
                    cdp, server, extension_origin, provider_id, previous_default_id
                )
            except Exception:
                pass
        cdp.ws.close()


def configure_provider(cdp: CDP, server: str, origin: str, provider_id: str) -> dict:
    return cdp.evaluate(
        "(async({server,origin,providerId,name,key})=>{const headers={"
        "'Content-Type':'application/json',Origin:origin};"
        "const current=await fetch(server+'/providers/default',{headers});"
        "if(!current.ok)return {saved:false,selected:false};"
        "const prev=(await current.json()).provider?.id||null;"
        "const provider={type:'openai-compatible',name,baseUrl:server+'/v1',"
        "modelId:'aster-a05-mock-test',supportsImages:false,contextWindow:32000,"
        "temperature:0.2,apiKey:key,createdAt:Date.now()};"
        "const saved=await fetch(server+'/providers/'+providerId,{method:'PUT',"
        "headers,body:JSON.stringify(provider)});"
        "if(!saved.ok)return {saved:false,selected:false,previousDefaultId:prev};"
        "const selected=await fetch(server+'/providers/default',{method:'PUT',"
        "headers,body:JSON.stringify({providerId})});"
        "return {saved:saved.ok,selected:selected.ok,previousDefaultId:prev}})"
        "({server:"
        + json.dumps(server)
        + ",origin:"
        + json.dumps(origin)
        + ",providerId:"
        + json.dumps(provider_id)
        + ",name:"
        + json.dumps(PROVIDER_NAME)
        + ",key:"
        + json.dumps(DUMMY_KEY)
        + "})"
    )


def delete_provider_and_restore_default(
    cdp: CDP,
    server: str,
    origin: str,
    provider_id: str,
    previous_default_id: str | None,
) -> None:
    cdp.evaluate(
        "(async({server,origin,providerId,previous})=>{const headers={"
        "'Content-Type':'application/json',Origin:origin};"
        "await fetch(server+'/providers/'+providerId,{method:'DELETE',headers});"
        "if(previous)await fetch(server+'/providers/default',{method:'PUT',"
        "headers,body:JSON.stringify({providerId:previous})});return true})"
        "({server:"
        + json.dumps(server)
        + ",origin:"
        + json.dumps(origin)
        + ",providerId:"
        + json.dumps(provider_id)
        + ",previous:"
        + json.dumps(previous_default_id)
        + "})"
    )


def running_wait_expression(prompt: str) -> str:
    return (
        "chrome.storage.local.get('executionHistoryByConversation').then(x=>"
        "Object.values(x.executionHistoryByConversation||{}).flatMap(c=>c.tasks||[])"
        ".some(t=>t.promptText==="
        + json.dumps(prompt)
        + "&&t.status==='running'&&t.steps.some(s=>s.toolName==='wait')))"
    )


def task_record_expression(prompt: str) -> str:
    return (
        "chrome.storage.local.get('executionHistoryByConversation').then(x=>"
        "Object.values(x.executionHistoryByConversation||{}).flatMap(c=>c.tasks||[])"
        ".find(t=>t.promptText==="
        + json.dumps(prompt)
        + "))"
    )


def task_status_by_id_expression(task_id: str) -> str:
    return (
        "chrome.storage.local.get('executionHistoryByConversation').then(x=>"
        "Object.values(x.executionHistoryByConversation||{}).flatMap(c=>c.tasks||[])"
        ".find(t=>t.id==="
        + json.dumps(task_id)
        + ")?.status||null)"
    )


def wait_for_task_storage_status(
    cdp: CDP, task_id: str, expected: str, timeout: float
) -> str | None:
    deadline = time.monotonic() + timeout
    status: str | None = None
    expression = task_status_by_id_expression(task_id)
    while time.monotonic() < deadline:
        status = cdp.evaluate(expression)
        if status == expected:
            return status
        time.sleep(0.1)
    return status


def read_task_state(cdp: CDP, conversation_id: str, task_id: str) -> dict:
    key = f"executionHistoryRecovery:{task_id}"
    return cdp.evaluate(
        "chrome.storage.local.get(['executionHistoryByConversation',"
        + json.dumps(key)
        + "]).then(x=>{const task=x.executionHistoryByConversation["
        + json.dumps(conversation_id)
        + "]?.tasks.find(t=>t.id==="
        + json.dumps(task_id)
        + ");return {taskStatus:task?.status||null,markerStatus:x["
        + json.dumps(key)
        + "]?.status||null}})"
    )


def task_row_expression(prompt: str) -> str:
    return (
        "[...document.querySelectorAll('a')].some(x=>x.innerText.includes("
        + json.dumps(prompt)
        + "))"
    )


def task_status_expression(prompt: str, status: str) -> str:
    return (
        "[...document.querySelectorAll('a')].some(x=>x.innerText.includes("
        + json.dumps(prompt)
        + ")&&x.innerText.includes("
        + json.dumps(status)
        + "))"
    )


def set_textarea_value(value: str) -> str:
    return (
        "(()=>{const e=document.querySelector('textarea');if(!e)throw new Error('No textarea');"
        "const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;"
        "set.call(e,"
        + json.dumps(value)
        + ");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
    )


def send_enabled() -> str:
    return (
        "[...document.querySelectorAll('button')].some(b=>"
        "b.textContent.trim()==='Send'&&!b.disabled)"
    )


def close_tab(tab_id: int) -> str:
    return (
        "(async({tabId})=>{await chrome.sidePanel.close({tabId}).catch(()=>{});"
        "await chrome.tabs.remove(tabId).catch(()=>{});return true})({tabId:"
        + str(tab_id)
        + "})"
    )


def cleanup_history(
    conversation_id: str | None, task_id: str | None, prompt: str
) -> str:
    return (
        "(async({conversationId,taskId,prompt})=>{const key='executionHistoryByConversation';"
        "const data=await chrome.storage.local.get(key);const histories=data[key]||{};"
        "for(const [id,history] of Object.entries(histories)){const tasks=history.tasks||[];"
        "const kept=tasks.filter(t=>t.promptText!==prompt&&(!taskId||t.id!==taskId));"
        "if(kept.length===tasks.length)continue;if(id===conversationId&&kept.length===0)delete histories[id];"
        "else histories[id]={...history,tasks:kept,updatedAt:Date.now()}}"
        "if(Object.keys(histories).length===0)await chrome.storage.local.remove(key);"
        "else await chrome.storage.local.set({[key]:histories});"
        "if(taskId)await chrome.storage.local.remove('executionHistoryRecovery:'+taskId);"
        "return true})({conversationId:"
        + json.dumps(conversation_id)
        + ",taskId:"
        + json.dumps(task_id)
        + ",prompt:"
        + json.dumps(prompt)
        + "})"
    )


def extension_origin_from_bundle(extension_dir: str) -> str:
    manifest_path = Path(extension_dir) / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        key = manifest["key"]
        digest = hashlib.sha256(base64.b64decode(key)).digest()[:16]
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise RuntimeError(f"cannot read extension identity from {manifest_path}: {error}") from error
    alphabet = "abcdefghijklmnop"
    extension_id = "".join(
        alphabet[value >> 4] + alphabet[value & 15] for value in digest
    )
    return f"chrome-extension://{extension_id}"


def verify_profile_owner(profile_dir: str) -> None:
    try:
        owner_uid = os.stat(profile_dir).st_uid
    except OSError as error:
        raise RuntimeError(f"cannot inspect profile directory {profile_dir}: {error}") from error
    if os.geteuid() != owner_uid:
        raise RuntimeError(
            "refusing to crash/relaunch BrowserOS: effective UID "
            f"{os.geteuid()} does not own profile directory {profile_dir} (UID {owner_uid}); "
            "run the smoke as the profile owner"
        )


def launch_browseros(
    browser_bin: str,
    profile_dir: str,
    extension_dir: str,
    cdp_port: int,
    server_port: int,
    extension_port: int,
) -> subprocess.Popen:
    root = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env.update(
        {
            "BROWSEROS_CDP_PORT": str(cdp_port),
            "BROWSEROS_SERVER_PORT": str(server_port),
            "BROWSEROS_EXTENSION_PORT": str(extension_port),
            "BROWSEROS_USER_DATA_DIR": profile_dir,
            "BROWSEROS_PRODUCT": "browseros",
            "BROWSEROS_DIR": str(Path(profile_dir) / "agent-state"),
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
    ]
    return subprocess.Popen(
        command,
        cwd=root,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def create_extension_app_target(
    cdp_base: str, extension_origin: str, *, timeout: float
) -> str:
    deadline = time.monotonic() + timeout
    version: dict | None = None
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{cdp_base}/json/version", timeout=2) as response:
                version = json.load(response)
            break
        except Exception as error:
            last_error = error
            time.sleep(0.2)
    if not version:
        raise TimeoutError(f"browser CDP endpoint was not ready: {last_error}")
    browser_cdp = CDP(version["webSocketDebuggerUrl"])
    try:
        target = browser_cdp.call(
            "Target.createTarget",
            {"url": f"{extension_origin}/app.html#/home"},
        )
    finally:
        browser_cdp.ws.close()
    target_id = target.get("targetId")
    if not isinstance(target_id, str) or not target_id:
        raise RuntimeError(f"Target.createTarget returned no targetId: {target}")
    return target_id


def wait_target_id(base: str, target_id: str, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/json/list", timeout=2) as response:
                targets = json.load(response)
            target = next((item for item in targets if item.get("id") == target_id), None)
            if target:
                return target
        except Exception as error:
            last_error = error
        time.sleep(0.2)
    raise TimeoutError(
        f"created CDP target {target_id} did not appear: {last_error}"
    )


def browser_process_matches(pid: int, profile_dir: str, cdp_port: int) -> bool:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as cmdline_file:
            command_line = cmdline_file.read().decode(errors="replace")
        with open(f"/proc/{pid}/comm", encoding="utf-8") as comm_file:
            process_name = comm_file.read().strip().casefold()
        executable = os.path.basename(os.readlink(f"/proc/{pid}/exe")).casefold()
    except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
        return False
    if process_name != "browseros" or executable != "browseros":
        return False
    return (
        f"--user-data-dir={profile_dir}" in command_line
        and f"--remote-debugging-port={cdp_port}" in command_line
        and "--type=" not in command_line
    )


def find_browser_process(profile_dir: str, cdp_port: int) -> int | None:
    for entry in os.scandir("/proc"):
        if not entry.name.isdecimal():
            continue
        pid = int(entry.name)
        if browser_process_matches(pid, profile_dir, cdp_port):
            return pid
    return None


def agent_server_process_matches(pid: int, sidecar_path: str) -> bool:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as cmdline_file:
            argv = [
                part.decode(errors="replace")
                for part in cmdline_file.read().split(b"\0")
                if part
            ]
        with open(f"/proc/{pid}/comm", encoding="utf-8") as comm_file:
            process_name = comm_file.read().strip().casefold()
        executable = os.path.basename(os.readlink(f"/proc/{pid}/exe")).casefold()
    except OSError:
        return False
    try:
        config_index = argv.index("--config")
    except ValueError:
        return False
    return (
        process_name == "bun"
        and executable == "bun"
        and "--watch" in argv
        and "src/index.ts" in argv
        and config_index + 1 < len(argv)
        and argv[config_index + 1] == sidecar_path
    )


def find_agent_server_process(sidecar_path: str) -> int | None:
    matches = [
        int(entry.name)
        for entry in os.scandir("/proc")
        if entry.name.isdecimal()
        and agent_server_process_matches(int(entry.name), sidecar_path)
    ]
    if len(matches) > 1:
        raise RuntimeError(
            "multiple Bun agent-server processes match the exact sidecar config: "
            f"{matches} ({sidecar_path})"
        )
    return matches[0] if matches else None


def terminate_agent_server_process(pid: int, sidecar_path: str) -> None:
    if not agent_server_process_matches(pid, sidecar_path):
        raise RuntimeError(
            "refusing to terminate Bun process because its sidecar identity changed"
        )
    os.kill(pid, signal.SIGKILL)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if not os.path.exists(f"/proc/{pid}"):
            return
        time.sleep(0.1)
    raise TimeoutError(f"agent-server process {pid} did not exit after SIGKILL")


def wait_for_agent_server_process(
    sidecar_path: str, *, timeout: float, exclude_pid: int | None = None
) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pid = find_agent_server_process(sidecar_path)
        if pid is not None and pid != exclude_pid:
            return pid
        time.sleep(0.2)
    raise TimeoutError(
        "agent-server process did not recover for exact sidecar config "
        f"{sidecar_path} (excluded PID {exclude_pid})"
    )


def wait_for_browser_process(
    profile_dir: str,
    cdp_port: int,
    *,
    timeout: float,
    exclude_pid: int | None = None,
) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pid = find_browser_process(profile_dir, cdp_port)
        if pid is not None and pid != exclude_pid:
            return pid
        time.sleep(0.2)
    raise TimeoutError(
        "BrowserOS process not found for exact profile and CDP port "
        f"(profile={profile_dir}, cdp_port={cdp_port})"
    )


def terminate_browser_process(pid: int, profile_dir: str, cdp_port: int) -> None:
    if not browser_process_matches(pid, profile_dir, cdp_port):
        raise RuntimeError(
            "refusing to terminate process because its BrowserOS profile/CDP identity changed"
        )
    os.kill(pid, signal.SIGKILL)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if not os.path.exists(f"/proc/{pid}"):
            return
        time.sleep(0.1)
    raise TimeoutError(f"BrowserOS process {pid} did not exit after SIGKILL")


def cleanup_fixture_tabs(server: str) -> str:
    fixture_url = server + "/system/health"
    return (
        "(async({url})=>{const tabs=await chrome.tabs.query({});"
        "for(const tab of tabs)if(tab.url===url){"
        "await chrome.sidePanel.close({tabId:tab.id}).catch(()=>{});"
        "await chrome.tabs.remove(tab.id).catch(()=>{});}return true})({url:"
        + json.dumps(fixture_url)
        + "})"
    )


def wait_target(base: str, fragment: str, timeout: float = 30) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/json/list", timeout=2) as response:
                targets = json.load(response)
            target = next(
                (item for item in targets if item.get("type") == "page"
                 and fragment in item.get("url", "")),
                None,
            )
            if target:
                return target
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError(f"Browser target not found: {fragment}")


def wait_for(
    cdp: CDP,
    description: str,
    *,
    expression: str | None = None,
    timeout: float = 15,
) -> None:
    condition = expression or description
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(condition):
                return
        except Exception:
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for {description}")


def request_json(
    url: str,
    *,
    method: str = "GET",
    origin: str | None = None,
    timeout: float = 3,
) -> tuple[int, dict | str]:
    headers = {"Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    request = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            return error.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return error.code, raw
    except (urllib.error.URLError, http.client.RemoteDisconnected, OSError) as error:
        return 0, f"{type(error).__name__}: {error}"


def wait_for_health(server: str, expected_up: bool, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    last_status: int | None = None
    while time.monotonic() < deadline:
        last_status, body = request_json(f"{server}/system/health", timeout=1)
        is_up = last_status == 200 and isinstance(body, dict) and body.get("status") == "ok"
        if is_up == expected_up:
            return
        time.sleep(0.1)
    raise TimeoutError(f"server did not go {'up' if expected_up else 'down'}; HTTP {last_status}")


def wait_for_status(
    url: str, expected: int, origin: str, timeout: float
) -> int:
    deadline = time.monotonic() + timeout
    last_status: int | None = None
    while time.monotonic() < deadline:
        last_status, _ = request_json(url, origin=origin, timeout=2)
        if last_status == expected:
            return last_status
        time.sleep(0.1)
    raise TimeoutError(f"expected HTTP {expected} from {url}; got {last_status}")


def wait_for_run_status(url: str, expected: str, origin: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    last_status: int | None = None
    last_body: dict | str | None = None
    while time.monotonic() < deadline:
        last_status, last_body = request_json(url, origin=origin, timeout=2)
        if (
            last_status == 200
            and isinstance(last_body, dict)
            and last_body.get("status") == expected
        ):
            return
        time.sleep(0.1)
    raise TimeoutError(
        f"server run did not reach status {expected}; got HTTP {last_status}: {last_body}"
    )


if __name__ == "__main__":
    raise SystemExit(main())
