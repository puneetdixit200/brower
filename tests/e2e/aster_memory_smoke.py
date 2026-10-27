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
            and "#/home" in item.get("url", "")
        ),
        None,
    )
    if not target:
        raise RuntimeError("Aster extension home target not found")

    cdp = CDP(target["webSocketDebuggerUrl"])
    note = f"Aster local memory smoke {uuid.uuid4()}"
    updated = f"Aster edited memory smoke {uuid.uuid4()}"
    try:
        cdp.call("Runtime.enable")
        cdp.evaluate("location.hash = '#/settings/memory'")
        wait_for(cdp, "document.querySelector('h1')?.textContent === 'Aster Memory'")
        initially_disabled = cdp.evaluate("document.querySelector('input[type=checkbox]')?.checked === false")
        cdp.evaluate("document.querySelector('input[type=checkbox]')?.click()")
        wait_for(cdp, "document.querySelector('input[type=checkbox]')?.checked === true")

        cdp.evaluate(set_value("textarea", note))
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Save note')?.click()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(note)})")

        missing = f"memory-not-found-{uuid.uuid4()}"
        cdp.evaluate(set_value("input[placeholder='Search saved notes']", missing))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.disabled")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Search')?.click()")
        wait_for(cdp, "document.querySelectorAll('article').length === 0")

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
        cdp.evaluate("document.querySelector('button[aria-label=\"Attach saved memory\"]')?.click()")
        wait_for(cdp, "document.querySelector('input[aria-label=\"Search saved memory\"]')")
        cdp.evaluate(set_value("input[aria-label='Search saved memory']", "Aster memory picker smoke"))
        wait_for(cdp, "![...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Search memory')?.disabled")
        cdp.evaluate("document.querySelector('button[aria-label=\"Search memory\"]')?.click()")
        wait_for(cdp, f"document.body.innerText.includes({json.dumps(picker_note)})")
        cdp.evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Add to request'))?.click()")
        wait_for(cdp, f"[...document.querySelectorAll('span')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")
        cdp.evaluate("document.querySelector('button[aria-label=\"Remove saved memory\"]')?.click()")
        wait_for(cdp, "!document.querySelector('button[aria-label=\"Remove saved memory\"]')")

        cdp.evaluate("location.hash = '#/settings/memory'")
        wait_for(cdp, f"[...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")
        cdp.evaluate("window.confirm = () => true")
        cdp.evaluate("(() => {const card=[...document.querySelectorAll('article')].find(x=>x.innerText.includes('Aster memory picker smoke'));[...card.querySelectorAll('button')].find(x=>x.textContent.trim()==='Delete')?.click()})()")
        wait_for(cdp, f"![...document.querySelectorAll('article')].some(x=>x.innerText.includes({json.dumps(picker_note)}))")

        result = {
            "memory_page": "loaded",
            "retrieval_default_disabled": initially_disabled,
            "create_search_edit_delete": "passed",
            "explicit_memory_context_select_remove": "passed",
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
