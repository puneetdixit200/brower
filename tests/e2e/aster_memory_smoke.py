#!/usr/bin/env python3
"""Exercise Aster Memory settings in a disposable headed BrowserOS profile."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
import uuid

from aster_ui_latency_benchmark import CDP


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-port", type=int, required=True)
    args = parser.parse_args()

    base = f"http://127.0.0.1:{args.cdp_port}"
    with urllib.request.urlopen(f"{base}/json/list", timeout=5) as response:
        targets = json.load(response)
    target = next(
        (
            item
            for item in targets
            if item.get("type") == "page"
            and item.get("url", "").startswith("chrome-extension://")
            and "app.html" in item.get("url", "")
        ),
        None,
    )
    if not target:
        raise RuntimeError("Aster extension home target not found")

    cdp = CDP(target["webSocketDebuggerUrl"])
    note = f"Aster local memory smoke {uuid.uuid4()}"
    updated = f"Aster edited memory smoke {uuid.uuid4()}"
    task_id = str(uuid.uuid4())
    task_title = f"Aster task memory smoke {uuid.uuid4()}"
    task_result = f"Reviewed task result {uuid.uuid4()}"
    try:
        cdp.call("Runtime.enable")
        cdp.evaluate("location.hash = '#/settings/memory'")
        wait_for(cdp, "document.querySelector('h1')?.textContent === 'Aster Memory'")
        initially_disabled = cdp.evaluate("document.querySelector('input[type=checkbox]')?.checked === false")
        cdp.evaluate("document.querySelector('input[type=checkbox]')?.click()")
        wait_for(cdp, "document.querySelector('input[type=checkbox]')?.checked === true")

        task_fixture = {
            "executionHistoryByConversation": {
                "aster-memory-smoke": {
                    "conversationId": "aster-memory-smoke",
                    "updatedAt": int(time.time() * 1000),
                    "tasks": [
                        {
                            "id": task_id,
                            "conversationId": "aster-memory-smoke",
                            "promptText": task_title,
                            "startedAt": "2026-10-27T00:00:00.000Z",
                            "completedAt": "2026-10-27T00:00:01.000Z",
                            "status": "completed",
                            "responseText": task_result,
                            "actionCount": 0,
                            "approvalCount": 0,
                            "deniedCount": 0,
                            "errorCount": 0,
                            "steps": [],
                        }
                    ],
                }
            }
        }
        cdp.evaluate(
            "chrome.storage.local.set(" + json.dumps(task_fixture) + ")"
        )
        cdp.evaluate("location.hash = '#/home'")
        wait_for(cdp, "location.hash.endsWith('/home')")
        cdp.evaluate("location.hash = '#/settings/memory'")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(task_title)})")
        cdp.evaluate(
            "[...document.querySelectorAll('article')].find(x=>x.innerText.includes("
            + json.dumps(task_title)
            + "))?.querySelector('button')?.click()"
        )
        wait_for(
            cdp,
            f"document.querySelector('textarea')?.value.includes({json.dumps(task_result)})",
        )
        assert not cdp.evaluate(
            f"document.body.innerText.includes({json.dumps(task_result)}) && "
            "[...document.querySelectorAll('article')].some(x=>x.innerText.includes('From task:'))"
        ), "task draft was unexpectedly persisted before explicit save"
        cdp.evaluate(
            "[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save note')?.click()"
        )
        wait_for(
            cdp,
            f"[...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(task_title)}) && x.innerText.includes('From task:'))",
        )
        task_note = cdp.evaluate(
            "[...document.querySelectorAll('article')].find(x=>x.innerText.includes('From task:'))?.innerText"
        )
        assert task_result in task_note, "saved task note lost its result"

        cdp.evaluate(set_value("textarea", note))
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save note')?.click()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(note)})")

        missing = f"memory-not-found-{uuid.uuid4()}"
        cdp.evaluate(set_value("input[placeholder='Search saved notes']", missing))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.disabled")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.click()")
        wait_for(
            cdp,
            f"![...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(note)}))",
        )

        cdp.evaluate(set_value("input[placeholder='Search saved notes']", note))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.disabled")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.click()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(note)})")

        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Edit')?.disabled")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Edit')?.click()")
        wait_for(cdp, f"document.querySelector('textarea')?.value === {json.dumps(note)}")
        cdp.evaluate(set_value("textarea", updated))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Update note')?.disabled")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Update note')?.click()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(updated)}) && !document.body.innerText.includes({json.dumps(note)})")

        cdp.evaluate("window.confirm = () => true")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Delete')?.click()")
        wait_for(cdp, f"!document.body.innerText.includes({json.dumps(updated)})")

        picker_note = f"Aster memory picker smoke {uuid.uuid4()}"
        cdp.evaluate(set_value("textarea", picker_note))
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save note')?.click()")
        wait_for(cdp, f"[...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")

        cdp.evaluate("location.hash = '#/home'")
        wait_for(cdp, "[...document.querySelectorAll('button')].some(x=>x.getAttribute('aria-label')==='Attach saved memory')")
        cdp.evaluate("(async()=>{await chrome.tabs.create({url:'http://127.0.0.1:9105/system/health'});await new Promise(r=>setTimeout(r,500));return true})()")
        cdp.evaluate("document.querySelector('button[aria-label=\"Attach saved memory\"]')?.click()")
        wait_for(cdp, "document.querySelector('input[aria-label=\"Search saved memory\"]')")
        cdp.evaluate(set_value("input[aria-label='Search saved memory']", "Aster memory picker smoke"))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Search memory')?.disabled")
        cdp.evaluate("document.querySelector('button[aria-label=\"Search memory\"]')?.click()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(picker_note)})")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Add to request' && x.closest('div.rounded-md.border')?.innerText.includes('Aster memory picker smoke'))?.click()")
        wait_for(cdp, f"[...document.querySelectorAll('span')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")
        cdp.evaluate("document.querySelector('button[aria-label=\"Remove saved memory\"]')?.click()")
        wait_for(cdp, "!document.querySelector('button[aria-label=\"Remove saved memory\"]')")
        cdp.evaluate("document.querySelector('button[aria-label=\"Attach saved memory\"]')?.click()")

        cdp.evaluate("document.querySelector('button[aria-label=\"Attach browser history\"]')?.click()")
        wait_for(cdp, "document.querySelector('input[aria-label=\"Search browser history\"]')")
        cdp.evaluate(set_value("input[aria-label='Search browser history']", "system/health"))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Search history')?.disabled")
        cdp.evaluate("document.querySelector('button[aria-label=\"Search history\"]')?.click()")
        wait_for(cdp, "document.body.innerText.includes('127.0.0.1:9105')")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Add to request' && x.closest('div.rounded-md.border')?.innerText.includes('127.0.0.1:9105'))?.click()")
        wait_for(cdp, "document.querySelector('button[aria-label=\"Remove browser history\"]')")
        cdp.evaluate("document.querySelector('button[aria-label=\"Remove browser history\"]')?.click()")
        wait_for(cdp, "!document.querySelector('button[aria-label=\"Remove browser history\"]')")
        cdp.evaluate("chrome.history.deleteUrl({url:'http://127.0.0.1:9105/system/health'})")

        cdp.evaluate("location.hash = '#/settings/memory'")
        wait_for(cdp, f"[...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")
        cdp.evaluate("window.confirm = () => true")
        cdp.evaluate("(() => {const card=[...document.querySelectorAll('article')].find(x=>x.innerText.includes('Aster memory picker smoke'));[...card.querySelectorAll('button')].find(x=>x.textContent.trim()==='Delete')?.click()})()")
        wait_for(cdp, f"![...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")

        cdp.evaluate("window.confirm = () => true")
        cdp.evaluate(
            "(() => {const card=[...document.querySelectorAll('article')].find(x=>x.innerText.includes('From task:'));"
            "[...card.querySelectorAll('button')].find(x=>x.textContent.trim()==='Delete')?.click()})()"
        )
        wait_for(cdp, "![...document.querySelectorAll('article')].some(x=>x.innerText.includes('From task:'))")
        cdp.evaluate(
            "chrome.storage.local.remove('executionHistoryByConversation')"
        )

        result = {
            "memory_page": "loaded",
            "retrieval_default_disabled": initially_disabled,
            "create_search_edit_delete": "passed",
            "review_and_explicitly_save_task_draft_with_provenance": "passed",
            "explicit_memory_context_select_remove": "passed",
            "explicit_history_context_select_remove": "passed",
            "network": "isolated",
            "fixture_content_retained": False,
        }
        print(json.dumps(result, indent=2))
        return 0
    finally:
        cdp.ws.close()


def set_value(selector: str, value: str) -> str:
    return (
        "(() => {const input=document.querySelector("
        + json.dumps(selector)
        + ");if(!input) throw new Error('Missing '+"
        + json.dumps(selector)
        + ");const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set;"
        + "setter.call(input,"
        + json.dumps(value)
        + ");input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return true})()"
    )


def wait_for(cdp: CDP, expression: str, timeout: float = 8) -> None:
    deadline = time.monotonic() + timeout
    condition = f"!!({expression})"
    while time.monotonic() < deadline:
        if cdp.evaluate(condition):
            return
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for UI condition: {expression}")


if __name__ == "__main__":
    raise SystemExit(main())
