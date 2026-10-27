#!/usr/bin/env python3
"""Verify Task History recovers a missing local run in a disposable profile."""

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
    conversation_id = str(uuid.uuid4())
    task_id = str(uuid.uuid4())
    task_title = f"Aster interrupted task recovery {uuid.uuid4()}"
    marker_key = f"executionHistoryRecovery:{task_id}"
    try:
        cdp.call("Runtime.enable")
        cdp.evaluate(seed_fixture(conversation_id, task_id, task_title))
        cdp.evaluate("location.hash = '#/tasks'")
        wait_for(cdp, "document.body.innerText.includes('Task History')")
        wait_for(cdp, task_row_expression(task_title))
        wait_for(
            cdp,
            f"{task_row_expression(task_title)} && "
            "[...document.querySelectorAll('a')].some(x=>x.innerText.includes("
            + json.dumps(task_title)
            + ") && x.innerText.includes('interrupted'))",
        )
        assert_recovery_storage(cdp, conversation_id, task_id, marker_key)

        cdp.evaluate("location.reload()")
        wait_for(cdp, "document.body.innerText.includes('Task History')")
        wait_for(
            cdp,
            "[...document.querySelectorAll('a')].some(x=>x.innerText.includes("
            + json.dumps(task_title)
            + ") && x.innerText.includes('interrupted'))",
        )
        assert_recovery_storage(cdp, conversation_id, task_id, marker_key)

        print(
            json.dumps(
                {
                    "task_history_missing_run_recovery_ui": "passed",
                    "underlying_task_record_remains_running": True,
                    "separate_recovery_marker_persists_after_reload": True,
                    "network": "localhost only",
                    "fixture_content_retained": False,
                    "process_crash_simulated": False,
                },
                indent=2,
            )
        )
        return 0
    finally:
        try:
            cdp.evaluate(cleanup_fixture(conversation_id, marker_key))
        finally:
            cdp.ws.close()


def seed_fixture(conversation_id: str, task_id: str, title: str) -> str:
    return (
        "(async()=>{const key='executionHistoryByConversation';"
        "const current=(await chrome.storage.local.get(key))[key]||{};"
        "current["
        + json.dumps(conversation_id)
        + "]={conversationId:"
        + json.dumps(conversation_id)
        + ",updatedAt:Date.now(),tasks:[{id:"
        + json.dumps(task_id)
        + ",conversationId:"
        + json.dumps(conversation_id)
        + ",promptText:"
        + json.dumps(title)
        + ",startedAt:new Date().toISOString(),status:'running',"
        "actionCount:0,approvalCount:0,deniedCount:0,errorCount:0,steps:[]}]};"
        "await chrome.storage.local.set({[key]:current});return true})()"
    )


def cleanup_fixture(conversation_id: str, marker_key: str) -> str:
    return (
        "(async()=>{const key='executionHistoryByConversation';"
        "const current=(await chrome.storage.local.get(key))[key]||{};"
        "delete current["
        + json.dumps(conversation_id)
        + "];"
        "if(Object.keys(current).length===0) await chrome.storage.local.remove(key);"
        "else await chrome.storage.local.set({[key]:current});"
        "await chrome.storage.local.remove("
        + json.dumps(marker_key)
        + ");return true})()"
    )


def task_row_expression(title: str) -> str:
    return (
        "[...document.querySelectorAll('a')].some(x=>x.innerText.includes("
        + json.dumps(title)
        + "))"
    )


def assert_recovery_storage(
    cdp: CDP, conversation_id: str, task_id: str, marker_key: str
) -> None:
    state = cdp.evaluate(
        "chrome.storage.local.get(['executionHistoryByConversation',"
        + json.dumps(marker_key)
        + "]).then(x=>({taskStatus:x.executionHistoryByConversation["
        + json.dumps(conversation_id)
        + "]?.tasks.find(t=>t.id==="
        + json.dumps(task_id)
        + ")?.status,markerStatus:x["
        + json.dumps(marker_key)
        + "]?.status,markerTaskId:x["
        + json.dumps(marker_key)
        + "]?.taskId}))"
    )
    assert state == {
        "taskStatus": "running",
        "markerStatus": "interrupted",
        "markerTaskId": task_id,
    }, f"unexpected recovery storage state: {state!r}"


def wait_for(cdp: CDP, expression: str, timeout: float = 12) -> None:
    deadline = time.monotonic() + timeout
    condition = f"!!({expression})"
    while time.monotonic() < deadline:
        if cdp.evaluate(condition):
            return
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for UI condition: {expression}")


if __name__ == "__main__":
    raise SystemExit(main())
