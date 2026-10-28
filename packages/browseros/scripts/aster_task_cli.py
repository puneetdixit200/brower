#!/usr/bin/env python3
"""Local-only Aster task inspection/cancellation.

Requires an already provisioned server MCP access token in ASTER_MCP_TOKEN.
Never passes a token as a command-line argument or grants model/browser tools.
No conversation text, tokens, or files are returned by this endpoint.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("command", choices=("status", "stop"))
    parser.add_argument("conversation_id")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1-65535")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", args.conversation_id):
        parser.error("conversation_id must be a bounded URL-safe ID")
    token = os.environ.get("ASTER_MCP_TOKEN", "")
    if not token:
        parser.error("ASTER_MCP_TOKEN must contain the existing Aster MCP access token")
    base = f"http://127.0.0.1:{args.port}/devcli/task/{args.conversation_id}"
    url = base + ("/stop" if args.command == "stop" else "")
    req = Request(
        url, method="POST" if args.command == "stop" else "GET",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urlopen(req, timeout=8) as response:
            data = json.loads(response.read(8192).decode("utf-8"))
    except HTTPError as error:
        print(f"Aster CLI request refused: HTTP {error.code}")
        return 1
    except (URLError, OSError, ValueError):
        print("Aster CLI could not reach the local server or read its response")
        return 1
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
