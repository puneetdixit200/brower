import json
import unittest
from contextlib import redirect_stderr
from io import BytesIO, StringIO
from unittest.mock import patch

import aster_file_attachment_smoke as smoke

from aster_file_attachment_smoke import (
    cleanup_temporary_provider,
    cleanup_with_resources,
    save_temporary_provider,
    seed_history_page,
    select_temporary_provider,
)


class FakeCDP:
    def __init__(self, responses):
        self.responses = list(responses)
        self.scripts = []

    def evaluate(self, script):
        self.scripts.append(script)
        return self.responses.pop(0)


class ProviderCleanupTests(unittest.TestCase):
    def test_cleanup_accepts_missing_temporary_provider_after_ambiguous_put(self):
        cdp = FakeCDP([{"status": 404}])

        cleanup_temporary_provider(
            cdp,
            "http://127.0.0.1:9821",
            "fresh-uuid-provider",
            None,
        )

        self.assertIn("fresh-uuid-provider", cdp.scripts[0])

    def test_saved_provider_can_be_cleaned_when_default_selection_fails(self):
        cdp = FakeCDP([{"status": 200}, {"status": 503}, {"status": 200}])

        saved_status = save_temporary_provider(
            cdp, "http://127.0.0.1:9821", "fixture-provider", 4567
        )
        provider_saved = saved_status == 200
        selected_status = select_temporary_provider(
            cdp, "http://127.0.0.1:9821", "fixture-provider"
        )
        self.assertTrue(provider_saved)
        self.assertEqual(selected_status, 503)

        cleanup_temporary_provider(
            cdp,
            "http://127.0.0.1:9821",
            "fixture-provider",
            None,
        )
        self.assertIn("/providers/${providerId}", cdp.scripts[-1])

    def test_cleanup_restores_prior_default_then_deletes_temporary_provider(self):
        cdp = FakeCDP([{"status": 200}, {"status": 200}])

        cleanup_temporary_provider(
            cdp,
            "http://127.0.0.1:9821",
            "fixture-provider",
            "previous-provider",
        )

        self.assertIn("/providers/default", cdp.scripts[0])
        self.assertIn("previous-provider", cdp.scripts[0])
        self.assertIn("/providers/${providerId}", cdp.scripts[1])
        self.assertIn("fixture-provider", cdp.scripts[1])

    def test_cleanup_without_previous_default_removes_temporary_default_provider(self):
        cdp = FakeCDP([{"status": 200}])

        cleanup_temporary_provider(
            cdp,
            "http://127.0.0.1:9821",
            "fixture-provider",
            None,
        )

        self.assertEqual(len(cdp.scripts), 1)
        self.assertIn("/providers/${providerId}", cdp.scripts[0])

    def test_provider_cleanup_failure_does_not_skip_owned_resource_closes(self):
        closed = []

        def fail_provider_cleanup():
            raise RuntimeError("provider restore failed")

        def fail_first_close():
            closed.append("first")
            raise OSError("first close failed")

        with self.assertRaisesRegex(RuntimeError, "provider restore failed"):
            stderr = StringIO()
            with redirect_stderr(stderr):
                cleanup_with_resources(
                    fail_provider_cleanup,
                    [
                        ("first close", fail_first_close),
                        ("second close", lambda: closed.append("second")),
                    ],
                )

        self.assertEqual(closed, ["first", "second"])
        self.assertIn("first close failed", stderr.getvalue())


class SeedHistoryPageCleanupTests(unittest.TestCase):
    def test_target_and_websocket_close_after_title_wait_failure(self):
        target = {
            "id": "synthetic-target",
            "webSocketDebuggerUrl": "ws://127.0.0.1/devtools/page/synthetic-target",
        }

        class FakeWebSocket:
            closed = False

            def close(self):
                self.closed = True

        class FakePageCDP:
            def __init__(self):
                self.ws = FakeWebSocket()

            def call(self, _method, _params=None):
                return {}

        page_cdp = FakePageCDP()
        open_responses = [
            BytesIO(json.dumps(target).encode("utf-8")),
            BytesIO(b"target is closing"),
        ]

        with patch.object(smoke, "CDP", return_value=page_cdp):
            with patch.object(smoke, "wait_for", side_effect=TimeoutError("title wait")):
                with patch.object(
                    smoke.urllib.request, "urlopen", side_effect=open_responses
                ) as urlopen:
                    with self.assertRaisesRegex(TimeoutError, "title wait"):
                        seed_history_page(
                            "http://127.0.0.1:9222",
                            "http://127.0.0.1:8123/synthetic",
                            "Synthetic title",
                        )

        self.assertTrue(page_cdp.ws.closed)
        self.assertEqual(urlopen.call_count, 2)
        self.assertIn(
            "/json/close/synthetic-target",
            urlopen.call_args_list[1].args[0].full_url,
        )


if __name__ == "__main__":
    unittest.main()
