#!/usr/bin/env python3
"""Verify side-panel drafts restore independently for two owner tabs."""

from __future__ import annotations

import json
import time
import urllib.request

from aster_ui_latency_benchmark import CDP


BASE = "http://127.0.0.1:9005"


def main() -> int:
    extension = wait_target("#/home")
    cdp = CDP(extension["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    tabs: list[int] = []
    try:
        for _ in range(2):
            tab = cdp.evaluate(
                "(async()=>await chrome.tabs.create({"
                "url:'http://127.0.0.1:9105/system/health',active:false}))()"
            )
            tabs.append(tab["id"])

        drafts = [f"draft for owner tab {tab_id}" for tab_id in tabs]
        for tab_id, draft in zip(tabs, drafts, strict=True):
            open_panel(cdp, tab_id)
            panel = wait_target(f"sidepanel.html?tabId={tab_id}")
            panel_cdp = CDP(panel["webSocketDebuggerUrl"])
            panel_cdp.call("Runtime.enable")
            try:
                wait_for(panel_cdp, "!!document.querySelector('textarea')")
                panel_cdp.evaluate(
                    "(()=>{const e=document.querySelector('textarea');"
                    "const set=Object.getOwnPropertyDescriptor("
                    "HTMLTextAreaElement.prototype,'value').set;set.call(e,"
                    + json.dumps(draft)
                    + ");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
                )
                wait_for(
                    cdp,
                    "(async({tabId,input})=>{const d=await chrome.storage.local.get('sidePanelDrafts');"
                    "return d.sidePanelDrafts?.[String(tabId)]?.input===input})({tabId:"
                    + str(tab_id)
                    + ",input:"
                    + json.dumps(draft)
                    + "})",
                )
            finally:
                panel_cdp.ws.close()
            cdp.evaluate(
                "(async({tabId})=>chrome.sidePanel.close({tabId}))({tabId:"
                + str(tab_id)
                + "})"
            )
            wait_no_target(f"sidepanel.html?tabId={tab_id}")

        observed: list[str] = []
        for tab_id, expected in zip(tabs, drafts, strict=True):
            open_panel(cdp, tab_id)
            panel = wait_target(f"sidepanel.html?tabId={tab_id}")
            panel_cdp = CDP(panel["webSocketDebuggerUrl"])
            panel_cdp.call("Runtime.enable")
            try:
                wait_for(
                    panel_cdp,
                    "document.querySelector('textarea')?.value==="
                    + json.dumps(expected),
                )
                observed.append(
                    panel_cdp.evaluate("document.querySelector('textarea').value")
                )
            finally:
                panel_cdp.ws.close()

        if observed != drafts:
            raise AssertionError(f"Drafts crossed owner tabs: {observed!r}")
        print(json.dumps({"per_tab_draft_isolation": "passed", "drafts_restored": 2}))
        return 0
    finally:
        try:
            cdp.evaluate(
                "(async(ids)=>{for(const tabId of ids){"
                "await chrome.sidePanel.close({tabId}).catch(()=>{});"
                "await chrome.tabs.remove(tabId).catch(()=>{});}"
                "await new Promise(r=>setTimeout(r,300));"
                "const d=await chrome.storage.local.get(['selectedTextMap','sidePanelDrafts']);"
                "for(const id of ids){delete d.selectedTextMap?.[String(id)];"
                "delete d.sidePanelDrafts?.[String(id)];}"
                "await chrome.storage.local.set({selectedTextMap:d.selectedTextMap||{},"
                "sidePanelDrafts:d.sidePanelDrafts||{}});})({ids:"
                + json.dumps(tabs)
                + "})"
            )
        except Exception:
            pass
        cdp.ws.close()


def open_panel(cdp: CDP, tab_id: int) -> None:
    cdp.evaluate(
        "(async({tabId})=>{await chrome.tabs.update(tabId,{active:true});"
        "await chrome.sidePanel.setOptions({"
        "tabId,path:`sidepanel.html?tabId=${tabId}`,enabled:true});"
        "await chrome.sidePanel.open({tabId});})({tabId:"
        + str(tab_id)
        + "})"
    )


def wait_target(fragment: str) -> dict:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"{BASE}/json/list", timeout=2))
            for target in targets:
                if target.get("type") == "page" and fragment in target.get("url", ""):
                    return target
        except Exception:
            pass
        time.sleep(0.2)
    raise TimeoutError(f"Browser target not found: {fragment}")


def wait_no_target(fragment: str) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        targets = json.load(urllib.request.urlopen(f"{BASE}/json/list", timeout=2))
        if not any(fragment in target.get("url", "") for target in targets):
            return
        time.sleep(0.1)
    raise TimeoutError(f"Browser target did not close: {fragment}")


def wait_for(cdp: CDP, expression: str) -> None:
    deadline = time.monotonic() + 15
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
