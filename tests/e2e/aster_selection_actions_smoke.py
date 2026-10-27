#!/usr/bin/env python3
"""Verify selected-text actions populate the side-panel composer."""

from __future__ import annotations

import json
import time
import urllib.request

from aster_ui_latency_benchmark import CDP


def main() -> int:
    base = "http://127.0.0.1:9005"
    extension_target = wait_for_target(base, "#/home")
    cdp = CDP(extension_target["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    fixture_tab_id: int | None = None
    try:
        fixture = cdp.evaluate(
            "(async()=>await chrome.tabs.create({"
            "url:'http://127.0.0.1:9105/system/health'}))()"
        )
        fixture_tab_id = fixture["id"]
        selected = seed_fixture_selection(cdp, fixture_tab_id)
        cdp.evaluate(
            "(async({tabId})=>{await chrome.sidePanel.setOptions({"
            "tabId,path:`sidepanel.html?tabId=${tabId}`,enabled:true});"
            "await chrome.sidePanel.open({tabId});return true})({tabId:"
            + str(fixture_tab_id)
            + "})"
        )

        panel = wait_for_target(base, f"sidepanel.html?tabId={fixture_tab_id}")
        panel_cdp = CDP(panel["webSocketDebuggerUrl"])
        panel_cdp.call("Runtime.enable")
        try:
            wait_for(
                panel_cdp,
                "!!document.querySelector('button[aria-label=\"Summarize selected text\"]')",
            )
            panel_cdp.evaluate(
                "[...document.querySelectorAll('button')].find(b=>"
                "b.getAttribute('aria-label')==='Summarize selected text')?.click()"
            )
            wait_for(
                panel_cdp,
                "document.querySelector('textarea')?.value.includes('three concise bullet points')&&"
                "document.querySelector('textarea')?.value.includes('UNTRUSTED_PAGE_CONTENT')&&"
                "document.querySelector('textarea')?.value.includes(" + json.dumps(selected) + ")",
            )
            summarize = panel_cdp.evaluate(
                "document.querySelector('textarea')?.value"
            )
            panel_cdp.evaluate(
                "[...document.querySelectorAll('button')].find(b=>"
                "b.getAttribute('aria-label')==='Translate selected text')?.click()"
            )
            wait_for(
                panel_cdp,
                "document.querySelector('textarea')?.value.includes('target language')&&"
                "document.querySelector('textarea')?.value.includes('UNTRUSTED_PAGE_CONTENT')&&"
                "document.querySelector('textarea')?.value.includes(" + json.dumps(selected) + ")",
            )
            translate = panel_cdp.evaluate(
                "document.querySelector('textarea')?.value"
            )
            wait_for(
                cdp,
                "(async({tabId,input})=>{const data=await chrome.storage.local.get('sidePanelDrafts');"
                "return data.sidePanelDrafts?.[String(tabId)]?.input===input})({tabId:"
                + str(fixture_tab_id)
                + ",input:"
                + json.dumps(translate)
                + "})",
            )
            cdp.evaluate(
                "(async({tabId})=>chrome.sidePanel.close({tabId}))({tabId:"
                + str(fixture_tab_id)
                + "})"
            )
            wait_for_no_target(base, f"sidepanel.html?tabId={fixture_tab_id}")
            cdp.evaluate(
                "(async({tabId})=>{await chrome.sidePanel.setOptions({"
                "tabId,path:`sidepanel.html?tabId=${tabId}`,enabled:true});"
                "await chrome.sidePanel.open({tabId});return true})({tabId:"
                + str(fixture_tab_id)
                + "})"
            )
            reopened_panel = wait_for_target(
                base, f"sidepanel.html?tabId={fixture_tab_id}"
            )
            reopened_cdp = CDP(reopened_panel["webSocketDebuggerUrl"])
            reopened_cdp.call("Runtime.enable")
            try:
                wait_for(
                    reopened_cdp,
                    "document.querySelector('textarea')?.value==="
                    + json.dumps(translate),
                )
            finally:
                reopened_cdp.ws.close()
        finally:
            panel_cdp.ws.sock.close()

        print(
            json.dumps(
                {
                    "selection_fixture_content": selected,
                    "summarize_action": summarize,
                    "translate_action": translate,
                    "draft_restore_after_panel_close": "passed",
                    "provider_request": "not sent; composer prompts only",
                    "network": "isolated",
                },
                indent=2,
            )
        )
        return 0
    finally:
        try:
            cdp.evaluate(
                "(async({tabId})=>{if(tabId!==null){"
                "await chrome.sidePanel.close({tabId}).catch(()=>{});"
                "await chrome.tabs.remove(tabId).catch(()=>{});"
                "await new Promise(resolve=>setTimeout(resolve,300));"
                "const stored=await chrome.storage.local.get(['selectedTextMap','sidePanelDrafts']).catch(()=>({}));"
                "if(stored.selectedTextMap){delete stored.selectedTextMap[String(tabId)];"
                "await chrome.storage.local.set({selectedTextMap:stored.selectedTextMap}).catch(()=>{});}"
                "if(stored.sidePanelDrafts){delete stored.sidePanelDrafts[String(tabId)];"
                "await chrome.storage.local.set({sidePanelDrafts:stored.sidePanelDrafts}).catch(()=>{});}}})({tabId:"
                + json.dumps(fixture_tab_id)
                + "})"
            )
        except Exception:
            pass
        cdp.ws.close()


def seed_fixture_selection(cdp: CDP, tab_id: int) -> str:
    selected = "Aster local health selection: status is ok and CDP is connected."
    cdp.evaluate(
        "(async({tabId,text})=>{const data=await chrome.storage.local.get('selectedTextMap');"
        "const map=data.selectedTextMap||{};map[String(tabId)]={text,pageUrl:"
        "'http://127.0.0.1:9105/system/health',pageTitle:'Aster local health',"
        "tabId,timestamp:Date.now()};await chrome.storage.local.set({selectedTextMap:map});"
        "return map[String(tabId)].text})({tabId:"
        + str(tab_id)
        + ",text:"
        + json.dumps(selected)
        + "})"
    )
    return selected


def wait_for_target(base: str, url_fragment: str) -> dict:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=2))
            target = next(
                (
                    item
                    for item in targets
                    if item.get("type") == "page" and url_fragment in item.get("url", "")
                ),
                None,
            )
            if target:
                return target
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError(f"Browser target not found: {url_fragment}")


def wait_for_no_target(base: str, url_fragment: str, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=2))
        if not any(url_fragment in item.get("url", "") for item in targets):
            return
        time.sleep(0.1)
    raise TimeoutError(f"Browser target did not close: {url_fragment}")


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
