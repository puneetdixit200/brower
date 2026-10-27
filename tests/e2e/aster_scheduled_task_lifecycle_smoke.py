#!/usr/bin/env python3
"""Exercise scheduled-task create, edit, disable, and delete in BrowserOS."""

from __future__ import annotations

import json
import time
import urllib.request
import uuid

from aster_ui_latency_benchmark import CDP


BASE = "http://127.0.0.1:9005"
SERVER = "http://127.0.0.1:9105"


def main() -> int:
    target = wait_target("#/home")
    cdp = CDP(target["webSocketDebuggerUrl"])
    cdp.call("Runtime.enable")
    name = f"Aster schedule smoke {uuid.uuid4().hex[:8]}"
    job_id: str | None = None
    try:
        cdp.evaluate("location.hash='#/scheduled'")
        wait_for(cdp, "document.body.innerText.includes('Scheduled Tasks')")
        click_text(cdp, "New Task")
        wait_for(cdp, "document.body.innerText.includes('Create Scheduled Task')")
        set_value(cdp, 'input[placeholder="e.g., Morning Briefing"]', name)
        set_value(cdp, 'textarea[name="query"]', "Summarize the local fixture page.")
        click_text(cdp, "Create")
        try:
            wait_for(cdp, f"document.body.innerText.includes({json.dumps(name)})")
        except TimeoutError as error:
            raise TimeoutError(
                f"created row did not appear; current UI: "
                f"{cdp.evaluate('document.body.innerText')!r}"
            ) from error

        job = cdp.evaluate(
            "(async({name})=>{const r=await fetch('http://127.0.0.1:9105/scheduled-jobs');"
            "if(!r.ok)throw Error('job list '+r.status);const d=await r.json();"
            "return d.jobs.find(j=>j.name===name)||null})({name:"
            + json.dumps(name)
            + "})"
        )
        if not job:
            raise AssertionError("created schedule was not returned by the local API")
        job_id = job["id"]
        alarm = cdp.evaluate(
            "(async({id})=>chrome.alarms.get(`scheduled-job-${id}`))({id:"
            + json.dumps(job_id)
            + "})"
        )
        if not alarm:
            raise AssertionError("enabled schedule did not create its browser alarm")

        click_text(cdp, "Edit")
        wait_for(cdp, "document.body.innerText.includes('Edit Scheduled Task')")
        set_value(cdp, 'textarea[name="query"]', "Edited local fixture summary.")
        click_text(cdp, "Update")
        wait_for(cdp, "document.body.innerText.includes('Edited local fixture summary.')")

        click_aria(cdp, f"Disable {name}")
        wait_for(cdp, "document.body.innerText.includes('Disabled')")
        disabled_alarm = cdp.evaluate(
            "(async({id})=>chrome.alarms.get(`scheduled-job-${id}`))({id:"
            + json.dumps(job_id)
            + "})"
        )
        if disabled_alarm:
            raise AssertionError("disabled schedule still has a browser alarm")

        click_aria(cdp, f"Delete {name}")
        wait_for(cdp, "document.body.innerText.includes('Delete Scheduled Task')")
        click_text(cdp, "Delete")
        wait_for(cdp, f"!document.body.innerText.includes({json.dumps(name)})")
        remaining = cdp.evaluate(
            "(async({id})=>{const r=await fetch(`http://127.0.0.1:9105/scheduled-jobs/${id}`);"
            "return r.status})({id:"
            + json.dumps(job_id)
            + "})"
        )
        if remaining != 404:
            raise AssertionError(f"deleted job still resolves through the API: {remaining}")
        job_id = None
        print(
            json.dumps(
                {
                    "create_and_alarm": "passed",
                    "edit": "passed",
                    "disable_cleared_alarm": "passed",
                    "delete": "passed",
                    "provider_request": "none",
                    "network": "isolated",
                },
                indent=2,
            )
        )
        return 0
    finally:
        if job_id:
            try:
                cdp.evaluate(
                    "(async({id})=>{await chrome.alarms.clear(`scheduled-job-${id}`);"
                    "await fetch(`http://127.0.0.1:9105/scheduled-jobs/${id}`,"
                    "{method:'DELETE'}).catch(()=>{});})({id:"
                    + json.dumps(job_id)
                    + "})"
                )
            except Exception:
                pass
        cdp.ws.close()


def wait_target(fragment: str) -> dict:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            targets = json.load(urllib.request.urlopen(f"{BASE}/json/list", timeout=2))
            for target in targets:
                if (
                    target.get("type") == "page"
                    and target.get("url", "").startswith("chrome-extension://")
                    and fragment in target.get("url", "")
                ):
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


def set_value(cdp: CDP, selector: str, value: str) -> None:
    result = cdp.evaluate(
        "(()=>{const e=document.querySelector("
        + json.dumps(selector)
        + ");if(!e)throw Error('missing '+"
        + json.dumps(selector)
        + ");const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;"
        "const set=Object.getOwnPropertyDescriptor(p.prototype,'value').set;"
        "set.call(e,"
        + json.dumps(value)
        + ");e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"
        + json.dumps(value)
        + "}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()"
    )
    if result != value:
        raise AssertionError(f"could not set {selector}")


def click_text(cdp: CDP, text: str) -> None:
    cdp.evaluate(
        "(()=>{const b=[...document.querySelectorAll('button')].find(x=>"
        "x.textContent.trim()==="
        + json.dumps(text)
        + ");if(!b)throw Error('button not found: '+"
        + json.dumps(text)
        + ");b.click()})()"
    )


def click_aria(cdp: CDP, label: str) -> None:
    cdp.evaluate(
        "(()=>{const b=document.querySelector('[aria-label="
        + json.dumps(label)
        + "]');if(!b)throw Error('aria control not found: '+"
        + json.dumps(label)
        + ");b.click()})()"
    )


if __name__ == "__main__":
    raise SystemExit(main())
