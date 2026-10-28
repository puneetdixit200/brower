import importlib.util
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "aster_dev_repl", HERE / "aster_dev_repl.py"
)
repl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repl)


class CommandBoundaryTest(unittest.TestCase):
    def test_allowed_commands_dispatch_only_expected_local_operations(self):
        calls = []

        def request(port, path, *, method="GET"):
            calls.append((port, path, method))
            if path == "/json/list":
                return [{"id": "tab_1", "type": "page", "title": "Example"}]
            return "ok"

        with mock.patch.object(repl, "request", side_effect=request):
            self.assertTrue(repl.dispatch_command(9234, ["tabs"], lambda _: None))
            self.assertTrue(
                repl.dispatch_command(
                    9234, ["open", "https://example.test/a?b=c"], lambda _: None
                )
            )
            self.assertTrue(
                repl.dispatch_command(9234, ["activate", "tab_1"], lambda _: None)
            )
            self.assertTrue(
                repl.dispatch_command(9234, ["close", "tab_1"], lambda _: None)
            )
            self.assertFalse(repl.dispatch_command(9234, ["quit"], lambda _: None))

        self.assertEqual(calls[0], (9234, "/json/list", "GET"))
        self.assertEqual(calls[1], (9234, "/json/new?https%3A%2F%2Fexample.test%2Fa%3Fb%3Dc", "PUT"))
        self.assertEqual(calls[2:], [
            (9234, "/json/activate/tab_1", "GET"),
            (9234, "/json/close/tab_1", "GET"),
        ])
        self.assertEqual(len(calls), 4)

    def test_eval_shell_and_unrecognized_commands_never_dispatch(self):
        forbidden = [
            ["eval", "alert(1)"],
            ["exec", "touch /tmp/pwned"],
            ["python", "-c", "print(1)"],
            ["sh", "-c", "id"],
            ["open", "https://example.test", ";", "touch", "x"],
        ]
        for words in forbidden:
            with self.subTest(words=words), mock.patch.object(repl, "request") as request:
                output = []
                self.assertTrue(repl.dispatch_command(9234, words, output.append))
                request.assert_not_called()
                self.assertTrue(output)

    def test_url_and_target_validation_rejects_unsafe_forms(self):
        invalid_urls = [
            "http://example.test/",
            "file:///etc/passwd",
            "https:///etc/passwd",
            "https://user:password@example.test/",
            "https://example.test/" + "x" * 2048,
        ]
        for url in invalid_urls:
            with self.subTest(url=url[:48]), self.assertRaises(ValueError):
                repl.validate_command(["open", url])

        for target in ("../tab", "../../etc/passwd", "tab/../../x", "", "x" * 257):
            for action in ("activate", "close"):
                with self.subTest(action=action, target=target), self.assertRaises(ValueError):
                    repl.validate_command([action, target])

    def test_shlex_input_does_not_evaluate_shell_syntax(self):
        words = repl.parse_command("open https://example.test/; touch /tmp/pwned")
        with self.assertRaises(ValueError):
            repl.validate_command(words)
        with self.assertRaisesRegex(ValueError, "Invalid command"):
            repl.parse_command("open 'unterminated")


class IsolationLifecycleTest(unittest.TestCase):
    def test_start_uses_ephemeral_port_loopback_and_given_profile(self):
        process = object()
        with mock.patch.object(repl.subprocess, "Popen", return_value=process) as popen:
            result = repl.start(Path("/opt/aster"), Path("/tmp/private-profile"), "auto")

        self.assertIs(result, process)
        args, kwargs = popen.call_args
        self.assertEqual(args[0][0], "/opt/aster")
        self.assertIn("--user-data-dir=/tmp/private-profile", args[0])
        self.assertIn("--remote-debugging-port=0", args[0])
        self.assertIn("--remote-debugging-address=127.0.0.1", args[0])
        self.assertNotIn("--remote-debugging-address=0.0.0.0", args[0])
        self.assertTrue(kwargs["start_new_session"])

    def test_eof_stops_child_and_removes_private_profile(self):
        class Child:
            pid = 4321
            returncode = None

            def poll(self):
                return self.returncode

            def wait(self, timeout=None):
                self.returncode = 0
                return 0

        child = Child()
        profiles = []
        profile_modes = []

        def start(_binary, profile, _ozone):
            profiles.append(profile)
            profile_modes.append(stat.S_IMODE(profile.stat().st_mode))
            return child

        def eof(_prompt):
            raise EOFError

        def group_is_gone(_pgid, sig):
            if sig == 0:
                raise ProcessLookupError

        with mock.patch.object(repl, "start", side_effect=start), \
             mock.patch.object(repl, "locate_port", return_value=9234), \
             mock.patch.object(repl.os, "killpg", side_effect=group_is_gone) as killpg:
            repl.run_repl(Path("/opt/aster"), "auto", input_fn=eof, emit=lambda _: None)

        profile = profiles[0]
        self.assertFalse(profile.exists())
        self.assertEqual(len(profile_modes), 1)
        self.assertEqual(profile_modes[0] & 0o077, 0)
        self.assertEqual(killpg.call_args_list, [
            mock.call(child.pid, signal.SIGTERM),
            mock.call(child.pid, 0),
            mock.call(child.pid, 0),
        ])

    def test_stop_kills_residual_group_when_leader_already_exited(self):
        class Child:
            pid = 9876
            returncode = 0
            waited = False

            def poll(self):
                return self.returncode

            def wait(self):
                self.waited = True
                return self.returncode

        child = Child()
        with mock.patch.object(repl.os, "killpg") as killpg:
            # SIGTERM and both group probes report a live group. Since timeout
            # is zero, cleanup must escalate despite the leader already exiting.
            repl.stop(child, timeout=0)

        self.assertEqual(killpg.call_args_list, [
            mock.call(child.pid, signal.SIGTERM),
            mock.call(child.pid, 0),
            mock.call(child.pid, 0),
            mock.call(child.pid, signal.SIGKILL),
        ])
        self.assertTrue(child.waited)

    def test_stop_treats_missing_process_group_as_already_gone(self):
        class Child:
            pid = 9877
            waited = False

            def poll(self):
                return 0

            def wait(self):
                self.waited = True
                return 0

        child = Child()
        with mock.patch.object(
            repl.os, "killpg", side_effect=ProcessLookupError
        ) as killpg:
            repl.stop(child)

        self.assertEqual(killpg.call_args_list, [
            mock.call(child.pid, signal.SIGTERM),
            mock.call(child.pid, 0),
            mock.call(child.pid, 0),
        ])
        self.assertTrue(child.waited)


if __name__ == "__main__":
    unittest.main()
