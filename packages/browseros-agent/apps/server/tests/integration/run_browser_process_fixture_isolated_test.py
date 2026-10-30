import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest

SCRIPT = Path(__file__).with_name("run_browser_process_fixture_isolated.py")
SPEC = importlib.util.spec_from_file_location("isolated_fixture", SCRIPT)
assert SPEC and SPEC.loader
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)


class IsolatedFixturePreflightTests(unittest.TestCase):
    def test_detects_default_route_from_ip_json(self):
        self.assertFalse(fixture.has_default_route("[]"))
        self.assertTrue(fixture.has_default_route(json.dumps([{"dst": "default", "dev": "eth0"}])))
        self.assertFalse(fixture.has_default_route(json.dumps([{"dst": "10.0.0.0/24", "dev": "lo"}])))

    def test_accepts_only_unreachable_style_external_probe_results(self):
        self.assertTrue(fixture.connect_result_is_blocked(101))  # ENETUNREACH on Linux
        self.assertTrue(fixture.connect_result_is_blocked(113))  # EHOSTUNREACH on Linux
        self.assertFalse(fixture.connect_result_is_blocked(0))
        self.assertFalse(fixture.connect_result_is_blocked(111))  # ECONNREFUSED still proves routing

    def test_direct_browser_mode_rejects_a_spoofed_namespace_descriptor(self):
        env = os.environ.copy()
        env["ASTER_FIXTURE_HOST_NETNS_FD"] = "1"
        result = subprocess.run(
            ["bun", str(fixture.FIXTURE), "--browser"],
            cwd=fixture.HERE.parents[1],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires a distinct network namespace", result.stderr)

    def test_internal_entrypoint_refuses_to_touch_host_network_namespace(self):
        env = os.environ.copy()
        env.pop("ASTER_FIXTURE_HOST_NETNS_FD", None)
        result = subprocess.run(
            ["python3", str(SCRIPT), "--inside-netns", "--preflight-only"],
            cwd=fixture.HERE.parents[1],
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("use the wrapper", result.stderr)


if __name__ == "__main__":
    unittest.main()
