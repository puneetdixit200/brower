#!/usr/bin/env python3
"""Run the --execute --browser process fixture in a loopback-only netns.

Run from apps/server. This creates an unprivileged user/network namespace and
makes no host firewall or routing changes. Requires Linux, unshare, ip, bun,
and the fixture binaries named by its documentation.
"""
from __future__ import annotations

import errno
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "process-approval-fixture.ts"
DENIED_CONNECT_ERRORS = {
    errno.EHOSTUNREACH,
    errno.ENETUNREACH,
}


def has_default_route(route_json: str) -> bool:
    routes = json.loads(route_json)
    return any(route.get("dst") == "default" for route in routes)


def connect_result_is_blocked(result: int) -> bool:
    return result in DENIED_CONNECT_ERRORS


def assert_loopback_tcp() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(1)
        client = socket.create_connection(listener.getsockname(), timeout=1)
        client.close()
        accepted, _ = listener.accept()
        accepted.close()
    finally:
        listener.close()


def assert_external_tcp_blocked(address: str, family: int) -> None:
    probe = socket.socket(family, socket.SOCK_STREAM)
    probe.settimeout(1)
    try:
        endpoint = (address, 443) if family == socket.AF_INET else (address, 443, 0, 0)
        result = probe.connect_ex(endpoint)
    finally:
        probe.close()
    if not connect_result_is_blocked(result):
        raise RuntimeError(
            f"external IP-literal TCP probe was not blocked ({address}:443, errno={result})"
        )


def namespace_preflight() -> None:
    interfaces = sorted(
        link["ifname"] for link in json.loads(subprocess.check_output(["ip", "-j", "link", "show"], text=True))
    )
    if interfaces != ["lo"]:
        raise RuntimeError(f"expected only loopback interface, found {interfaces}")
    for family in ("-4", "-6"):
        routes = subprocess.check_output(["ip", family, "-j", "route", "show", "default"], text=True)
        if has_default_route(routes):
            raise RuntimeError(f"network namespace has an IPv{family[1]} default route")
    assert_loopback_tcp()
    assert_external_tcp_blocked("1.1.1.1", socket.AF_INET)
    assert_external_tcp_blocked("2606:4700:4700::1111", socket.AF_INET6)
    print("network preflight passed: loopback works; public IPv4/IPv6 are unreachable", flush=True)


def assert_inside_new_netns() -> None:
    host_namespace_fd = os.environ.get("ASTER_FIXTURE_HOST_NETNS_FD", "")
    if not host_namespace_fd.isdecimal():
        raise RuntimeError("use the wrapper to enter an isolated network namespace")
    try:
        host_namespace = os.readlink(f"/proc/self/fd/{host_namespace_fd}")
    except OSError as error:
        raise RuntimeError("wrapper host network namespace descriptor is unavailable") from error
    current_namespace = os.readlink("/proc/self/ns/net")
    if not host_namespace.startswith("net:[") or current_namespace == host_namespace:
        raise RuntimeError("wrapper did not enter a distinct network namespace")


def main() -> int:
    if sys.platform != "linux":
        raise SystemExit("isolated browser fixture requires Linux")
    if sys.argv[1:] in (["--inside-netns"], ["--inside-netns", "--preflight-only"]):
        assert_inside_new_netns()
        preflight_only = "--preflight-only" in sys.argv
        subprocess.run(["ip", "link", "set", "dev", "lo", "up"], check=True)
        namespace_preflight()
        if preflight_only:
            return 0
        os.execvp("bun", ["bun", str(FIXTURE), "--execute", "--browser"])
    preflight_only = sys.argv[1:] == ["--preflight-only"]
    if sys.argv[1:] not in ([], ["--preflight-only"]):
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} [--preflight-only]")
    command = [
        "unshare", "--user", "--map-root-user", "--net", "--",
        sys.executable, str(Path(__file__).resolve()), "--inside-netns",
        *( ["--preflight-only"] if preflight_only else [] ),
    ]
    try:
        env = os.environ.copy()
        host_namespace_fd = os.open("/proc/self/ns/net", os.O_RDONLY)
        env["ASTER_FIXTURE_HOST_NETNS_FD"] = str(host_namespace_fd)
        try:
            return subprocess.run(
                command,
                cwd=HERE.parents[1],
                env=env,
                pass_fds=(host_namespace_fd,),
                check=False,
            ).returncode
        finally:
            os.close(host_namespace_fd)
    except FileNotFoundError as error:
        raise SystemExit(f"required namespace command unavailable: {error.filename}") from error


if __name__ == "__main__":
    raise SystemExit(main())
