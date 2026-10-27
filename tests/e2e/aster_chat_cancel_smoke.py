#!/usr/bin/env python3
"""Verify the side-panel Stop control aborts a pending local mock chat run."""

from __future__ import annotations

import json
import time
import urllib.request
import urllib.parse
import uuid

from aster_ui_latency_benchmark import CDP


BASE = "http://127.0.0.1:9005"
SERVER = "http://127.0.0.1:9105"


def main() -> int:
    target = wait_target("#/home")
    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    provider_id = f"aster-cancel-smoke-{uuid.uuid4()}"
    provider_saved = False
    fixture_tab_id: int | None = None
    panel_cdp: CDP | None = None
    try:
        wait_for(
            cdp,
            "fetch('http://127.0.0.1:9105/system/health').then(r=>r.ok).catch(()=>false)",
            timeout=45,
        )
        configured = cdp.evaluate(
            "(async({providerId})=>{const p={type:'openai-compatible',"
            "name:'Aster Cancel Fixture Mock',baseUrl:'http://127.0.0.1:9105/v1',"
            "modelId:'aster-test-mock',supportsImages:false,contextWindow:32000,"
            "temperature:0.2,apiKey:'test-only-dummy',createdAt:Date.now()};"
            "const headers={'Content-Type':'application/json'};"
            "const saved=await fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
            "{method:'PUT',headers,body:JSON.stringify(p)});"
            "if(!saved.ok)return {saved:saved.status};"
            "const selected=await fetch('http://127.0.0.1:9105/providers/default',"
            "{method:'PUT',headers,body:JSON.stringify({providerId})});"
            "return {saved:saved.status,selected:selected.status}})({providerId:"
            + json.dumps(provider_id)
            + "})"
        )
        provider_saved = configured.get("saved") == 200
        if configured.get("saved") != 200 or configured.get("selected") != 200:
            raise RuntimeError(f"could not configure local mock provider: {configured}")
        cdp.evaluate("location.reload()")
        wait_for(cdp, "document.body.innerText.includes('Aster Cancel Fixture Mock')")

        fixture = cdp.evaluate(
            "(async()=>await chrome.tabs.create({"
            "url:'http://127.0.0.1:9105/system/health'}))()"
        )
        fixture_tab_id = fixture["id"]
        cdp.evaluate(
            "(async({tabId})=>{await chrome.sidePanel.setOptions({"
            "tabId,path:`sidepanel.html?tabId=${tabId}`,enabled:true});"
            "await chrome.sidePanel.open({tabId});return true})({tabId:"
            + str(fixture_tab_id)
            + "})"
        )
        panel = wait_target(f"sidepanel.html?tabId={fixture_tab_id}")
        extension_origin = urllib.parse.urlsplit(panel["url"])
        extension_origin = f"{extension_origin.scheme}://{extension_origin.netloc}"
        panel_cdp = CDP(panel["webSocketDebuggerUrl"])
        panel_cdp.call("Runtime.enable")
        wait_for(panel_cdp, "!!document.querySelector('textarea')")
        panel_cdp.evaluate(
            "(()=>{const e=document.querySelector('textarea');"
            "const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;"
            "set.call(e,'Stop this deliberately delayed local test response.');"
            "e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
        )
        wait_for(
            panel_cdp,
            "[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Send'&&!b.disabled)",
        )
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Send').click()"
        )
        wait_for(
            panel_cdp,
            "document.body.innerText.toLowerCase().includes('wait')",
        )
        wait_for(
            panel_cdp,
            "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Stop'))",
        )
        task_state = (
            "(async()=>{const data=await chrome.storage.local.get('executionHistoryByConversation');"
            "const records=Object.values(data.executionHistoryByConversation||{}).flatMap(x=>x.tasks||[]);"
            "return records.filter(x=>x.status==='running').sort((a,b)=>"
            "Date.parse(b.startedAt)-Date.parse(a.startedAt))[0]?.conversationId||null})()"
        )
        wait_for(cdp, f"{task_state}")
        conversation_id = cdp.evaluate(task_state)
        if not conversation_id:
            raise RuntimeError("chat submission did not expose a conversation id")
        state_url = f"{SERVER}/chat/{conversation_id}/state"
        wait_state(state_url, "running", extension_origin)
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Stop')).click()"
        )
        wait_state(state_url, "aborted", extension_origin, timeout=10)
        if panel_cdp.evaluate("document.body.innerText.includes('Mock BrowserOS test response.')"):
            raise RuntimeError("mock response completed after the run was stopped")

        print(
            json.dumps(
                {
                    "pending_chat_created": "passed",
                    "pending_abortable_wait_tool": "rendered",
                    "sidepanel_stop_control": "clicked",
                    "server_run_status": "aborted",
                    "mock_response_after_stop": "absent",
                    "provider_request": "local mock only; dummy key",
                    "network": "isolated",
                },
                indent=2,
            )
        )
        return 0
    finally:
        if panel_cdp:
            panel_cdp.ws.close()
        try:
            if fixture_tab_id is not None:
                cdp.evaluate(
                    "(async({tabId})=>{await chrome.sidePanel.close({tabId}).catch(()=>{});"
                    "await chrome.tabs.remove(tabId).catch(()=>{})})({tabId:"
                    + str(fixture_tab_id)
                    + "})"
                )
        except Exception:
            pass
        if provider_saved:
            try:
                cdp.evaluate(
                    "(async({providerId})=>fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
                    "{method:'DELETE'}).catch(()=>{}))({providerId:"
                    + json.dumps(provider_id)
                    + "})"
                )
            except Exception:
                pass
        cdp.ws.close()


def wait_target(fragment: str) -> dict:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"{BASE}/json/list", timeout=2))
            target = next(
                (item for item in targets if item.get("type") == "page" and fragment in item.get("url", "")),
                None,
            )
            if target:
                return target
        except Exception:
            pass
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


def wait_state(
    url: str, status: str, origin: str, timeout: float = 10
) -> None:
    deadline = time.monotonic() + timeout
    last_result = "no response"
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(url, headers={"Origin": origin})
            with urllib.request.urlopen(request, timeout=2) as response:
                body = json.load(response)
                last_result = f"HTTP {response.status}: {body}"
                if body.get("status") == status:
                    return
        except Exception as error:
            last_result = f"{type(error).__name__}: {error}"
        time.sleep(0.1)
    raise TimeoutError(
        f"Timed out waiting for server run status {status}; last result: {last_result}"
    )


if __name__ == "__main__":
    raise SystemExit(main())
