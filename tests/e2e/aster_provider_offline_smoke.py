#!/usr/bin/env python3
"""Verify chat reports and retries an unreachable configured model provider."""

from __future__ import annotations

import json
import time
import urllib.request
import uuid

from aster_ui_latency_benchmark import CDP


BASE = "http://127.0.0.1:9005"
SERVER = "http://127.0.0.1:9105"
DUMMY_KEY = "aster-offline-dummy-only"


def main() -> int:
    home = wait_target("#/home")
    cdp = CDP(home["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    provider_id = f"aster-offline-smoke-{uuid.uuid4()}"
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
            "(async({providerId,key})=>{const p={type:'openai-compatible',"
            "name:'Aster Offline Fixture',baseUrl:'http://127.0.0.1:9106/v1',"
            "modelId:'aster-offline-test',supportsImages:false,contextWindow:32000,"
            "temperature:0.2,apiKey:key,createdAt:Date.now()};"
            "const headers={'Content-Type':'application/json'};"
            "const saved=await fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
            "{method:'PUT',headers,body:JSON.stringify(p)});"
            "if(!saved.ok)return {saved:saved.status};"
            "const selected=await fetch('http://127.0.0.1:9105/providers/default',"
            "{method:'PUT',headers,body:JSON.stringify({providerId})});"
            "return {saved:saved.status,selected:selected.status}})({providerId:"
            + json.dumps(provider_id)
            + ",key:"
            + json.dumps(DUMMY_KEY)
            + "})"
        )
        provider_saved = configured.get("saved") == 200
        if configured.get("saved") != 200 or configured.get("selected") != 200:
            raise RuntimeError(f"could not configure offline provider fixture: {configured}")
        cdp.evaluate("location.reload()")
        wait_for(cdp, "document.body.innerText.includes('Aster Offline Fixture')")

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
        panel_cdp = CDP(panel["webSocketDebuggerUrl"])
        panel_cdp.call("Runtime.enable")
        wait_for(panel_cdp, "!!document.querySelector('textarea')")
        panel_cdp.evaluate(
            "(()=>{const e=document.querySelector('textarea');"
            "const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;"
            "set.call(e,'Explain this local fixture status.');"
            "e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
        )
        wait_for(
            panel_cdp,
            "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Send'&&!b.disabled)",
        )
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send').click()"
        )
        wait_for(
            panel_cdp,
            "document.body.innerText.includes('Connection failed')&&"
            "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Try again'))",
            timeout=45,
        )
        first_error = panel_cdp.evaluate("document.body.innerText")
        if DUMMY_KEY in first_error:
            raise AssertionError("provider dummy key appeared in the user-visible error")
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Try again')).click()"
        )
        wait_for(
            panel_cdp,
            "document.body.innerText.includes('Connection failed')&&"
            "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Try again'))",
            timeout=45,
        )
        retried_error = panel_cdp.evaluate("document.body.innerText")
        if DUMMY_KEY in retried_error:
            raise AssertionError("provider dummy key appeared after retry")

        # Simulate the local agent endpoint being unavailable only for this
        # extension target, without stopping the shared dev server process.
        panel_cdp.call("Network.enable")
        panel_cdp.call(
            "Network.setBlockedURLs", {"urls": [f"{SERVER}/chat*"]}
        )
        panel_cdp.evaluate(
            "(()=>{const e=document.querySelector('textarea');"
            "const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;"
            "set.call(e,'Check local agent availability.');"
            "e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
        )
        wait_for(
            panel_cdp,
            "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Send'&&!b.disabled)",
        )
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Send').click()"
        )
        wait_for(
            panel_cdp,
            "document.body.innerText.includes('Could not reach Aster’s local AI service')&&"
            "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Try again'))",
            timeout=45,
        )
        local_error = panel_cdp.evaluate("document.body.innerText")
        if "docs.browseros.com/troubleshooting" in local_error:
            raise AssertionError("local agent error retained the upstream help URL")
        panel_cdp.call("Network.setBlockedURLs", {"urls": []})
        panel_cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Try again')).click()"
        )
        wait_for(
            panel_cdp,
            "document.body.innerText.includes('Connection failed')&&"
            "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Try again'))",
            timeout=45,
        )

        print(
            json.dumps(
                {
                    "unreachable_provider": "127.0.0.1:9106; no service",
                    "user_visible_error": "Connection failed",
                    "retry_control": "passed",
                    "retry_repeats_connection_error": "passed",
                    "local_agent_failure_copy": "passed",
                    "retry_recovers_after_local_request_unblocked": "passed",
                    "dummy_key_redaction": "passed",
                    "network": "isolated; no external provider contacted",
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
                    "await chrome.tabs.remove(tabId).catch(()=>{});"
                    "const key='executionHistoryByConversation';const data=await chrome.storage.local.get(key);"
                    "const records=data[key]||{};for(const [id,history] of Object.entries(records)){"
                    "if(history.tasks?.some(task=>task.promptText==='Explain this local fixture status.'))"
                    "delete records[id]}await chrome.storage.local.set({[key]:records})})({tabId:"
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
    deadline = time.monotonic() + 45
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


def wait_for(cdp: CDP, expression: str, timeout: float = 20) -> None:
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
