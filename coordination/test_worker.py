"""Offline tests for the wrapper's Git staging/commit safety boundary."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("aster_worker", ROOT / "worker.py")
assert spec and spec.loader
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerCommitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.execute("git", "init", "-q")
        self.execute("git", "config", "user.email", "aster-worker-test@example.test")
        self.execute("git", "config", "user.name", "Aster Worker Test")
        (self.repo / "docs").mkdir()
        (self.repo / "docs" / "README.md").write_text("baseline\n")
        self.execute("git", "add", "docs/README.md")
        self.execute("git", "commit", "-qm", "test: initial")
        self.baseline = self.execute("git", "rev-parse", "HEAD").stdout.strip()

    def execute(self, *args: str) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(
            args, cwd=self.repo, capture_output=True, text=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed

    def test_source_edits_are_committed_only_outside_sandbox(self) -> None:
        (self.repo / "docs" / "README.md").write_text("changed\n")
        (self.repo / "docs" / "proof.md").write_text("safe evidence\n")
        result, changed = worker.commit_codex_changes(
            self.repo, "ASTER-20261102-901", self.baseline,
        )
        self.assertNotEqual(result, self.baseline)
        self.assertEqual(changed, ["docs/README.md", "docs/proof.md"])
        self.assertFalse(self.execute("git", "status", "--porcelain").stdout.strip())
        self.assertIn(
            "feat(aster): implement aster-20261102-901",
            self.execute("git", "log", "-1", "--pretty=%s").stdout,
        )

    def test_clean_noop_does_not_create_a_commit(self) -> None:
        result, changed = worker.commit_codex_changes(
            self.repo, "ASTER-20261102-902", self.baseline,
        )
        self.assertIsNone(result)
        self.assertEqual(changed, [])
        self.assertEqual(self.execute("git", "rev-parse", "HEAD").stdout.strip(),
                         self.baseline)

    def test_sensitive_untracked_file_remains_unstaged(self) -> None:
        (self.repo / "docs" / ".env.production").write_text("TOKEN=redacted\n")
        with self.assertRaisesRegex(RuntimeError, "sensitive/unowned"):
            worker.commit_codex_changes(
                self.repo, "ASTER-20261102-903", self.baseline,
            )
        self.assertFalse(self.execute("git", "diff", "--cached", "--name-only").stdout)
        self.assertTrue((self.repo / "docs" / ".env.production").exists())

    def test_refuses_checkout_that_advanced_during_task(self) -> None:
        (self.repo / "docs" / "README.md").write_text("new commit\n")
        self.execute("git", "add", "docs/README.md")
        self.execute("git", "commit", "-qm", "test: parallel change")
        with self.assertRaisesRegex(RuntimeError, "HEAD changed"):
            worker.commit_codex_changes(
                self.repo, "ASTER-20261102-904", self.baseline,
            )

    def test_unowned_paths_refused_without_discarding_work(self) -> None:
        (self.repo / "unexpected.txt").write_text("keep this\n")
        with self.assertRaisesRegex(RuntimeError, "sensitive/unowned"):
            worker.commit_codex_changes(
                self.repo, "ASTER-20261102-905", self.baseline,
            )
        self.assertTrue((self.repo / "unexpected.txt").exists())


if __name__ == "__main__":
    unittest.main()
