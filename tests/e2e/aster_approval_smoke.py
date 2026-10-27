#!/usr/bin/env python3
"""Approve one deterministic, harmless browser click in a disposable profile."""

from __future__ import annotations

import json
import time
import urllib.request
import uuid

from aster_ui_latency_benchmark import CDP


def main() -> int:
    base = "http://127.0.0.1:9005"
    target = wait_for_target(base)
    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    provider_id = f"aster-approval-smoke-{uuid.uuid4()}"
    fixture_tab_id: int | None = None
    provider_saved = False
    try:
        setup = cdp.evaluate(
            "(async ({providerId}) => {"
            "const provider={type:'openai-compatible',"
            "name:'Aster Approval Fixture Mock',"
            "baseUrl:'http://127.0.0.1:9105/v1',modelId:'aster-test-mock',"
            "supportsImages:false,contextWindow:32000,temperature:0.2,"
            "apiKey:'test-only-dummy',createdAt:Date.now()};"
            "const headers={'Content-Type':'application/json'};"
            "const saved=await fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
            "{method:'PUT',headers,body:JSON.stringify(provider)});"
            "const selected=await fetch('http://127.0.0.1:9105/providers/default',"
            "{method:'PUT',headers,body:JSON.stringify({providerId})});"
            "const tab=await chrome.tabs.create({url:'http://127.0.0.1:9191/'});"
            "return {saved:saved.status,selected:selected.status,tabId:tab.id};"
            "})({providerId:" + json.dumps(provider_id) + "})"
        )
        provider_saved = setup["saved"] == 200
        fixture_tab_id = setup["tabId"]
        if setup["saved"] != 200 or setup["selected"] != 200:
            raise RuntimeError(f"Could not create mock provider: {setup}")

        cdp.evaluate("location.reload()")
        wait_for(cdp, "document.body.innerText.includes('Aster Approval Fixture Mock')")
        set_value(
            cdp,
            "textarea",
            "Click the button in the local Aster approval fixture.",
        )
        cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>"
            "b.querySelector('svg.lucide-arrow-right'))?.click()"
        )
        wait_for(cdp, "location.hash.includes('/home/chat')")
        wait_for(cdp, "document.body.innerText.includes('Approve')")
        cdp.evaluate(
            "[...document.querySelectorAll('button')].find(b=>"
            "b.textContent.trim()==='Approve')?.click()"
        )
        wait_for(cdp, "document.body.innerText.includes('Mock BrowserOS test response.')")

        targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=5))
        fixture = next(
            item
            for item in targets
            if item.get("type") == "page"
            and item.get("url") == "http://127.0.0.1:9191/"
        )
        fixture_cdp = CDP(fixture["webSocketDebuggerUrl"])
        fixture_cdp.call("Runtime.enable")
        clicked_text = fixture_cdp.evaluate(
            "document.querySelector('#target')?.textContent"
        )
        fixture_cdp.ws.close()
        if clicked_text != "Clicked safely":
            raise RuntimeError(
                f"Approved action did not update the fixture: {clicked_text!r}"
            )

        print(
            json.dumps(
                {
                    "approval_card": "shown",
                    "approval": "approved",
                    "tool": "act.click",
                    "fixture_result": clicked_text,
                    "network": "isolated",
                    "provider_credential": "dummy only",
                },
                indent=2,
            )
        )
        return 0
    finally:
        try:
            cdp.evaluate(
                "(async ({providerId,tabId,providerSaved})=>{"
                "if(tabId!==null) await chrome.tabs.remove(tabId).catch(()=>{});"
                "if(providerSaved) await fetch(`http://127.0.0.1:9105/providers/${providerId}`,"
                "{method:'DELETE'}).catch(()=>{});"
                "})({providerId:"
                + json.dumps(provider_id)
                + ",tabId:"
                + json.dumps(fixture_tab_id)
                + ",providerSaved:"
                + json.dumps(provider_saved)
                + "})"
            )
        except Exception:
            pass
        cdp.ws.close()


def wait_for_target(base: str) -> dict:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"{base}/json/list", timeout=2))
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
            if target:
                return target
        except Exception:
            time.sleep(0.5)
    raise TimeoutError("Aster home CDP target did not start")


def wait_for(cdp: CDP, expression: str, timeout: float = 40) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if cdp.evaluate(expression):
                return
        except Exception:
            pass
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for UI condition: {expression}")


def set_value(cdp: CDP, selector: str, value: str) -> None:
    cdp.evaluate(
        "(() => {const input=document.querySelector("
        + json.dumps(selector)
        + ");const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;"
        + "setter.call(input,"
        + json.dumps(value)
        + ");input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"
        + json.dumps(value)
        + "}));return input.value})()"
    )


if __name__ == "__main__":
    raise SystemExit(main())
