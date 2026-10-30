import unittest

from aster_file_attachment_smoke import (
    cleanup_temporary_provider,
    save_temporary_provider,
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


if __name__ == "__main__":
    unittest.main()
