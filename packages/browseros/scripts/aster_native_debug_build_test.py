import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("aster_native_debug_build", HERE / "aster_native_debug_build.py")
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


def git(path, *args):
    return subprocess.run(["git", *args], cwd=path, check=True, capture_output=True, text=True).stdout.strip()


class NativePinTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.src = self.root / "src"
        self.src.mkdir()
        version = self.repo / "packages/browseros/CHROMIUM_VERSION"
        version.parent.mkdir(parents=True)
        version.write_text("MAJOR=1\nMINOR=2\nBUILD=3\nPATCH=4\n")
        git(self.src, "init", "-q")
        git(self.src, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-qm", "initial")
        git(self.src, "tag", "1.2.3.4")

    def test_pinned_head_and_uncommitted_patches(self):
        (self.src / "patch-file").write_text("local patch")
        driver._verify_chromium_pin(self.repo, self.src)

    def test_missing_pin_and_mismatched_head_fail_closed(self):
        git(self.src, "tag", "-d", "1.2.3.4")
        with self.assertRaisesRegex(RuntimeError, "Cannot verify local Chromium pin"):
            driver._verify_chromium_pin(self.repo, self.src)
        git(self.src, "tag", "1.2.3.4")
        git(self.src, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-qm", "different")
        with self.assertRaisesRegex(RuntimeError, "does not match pinned tag"):
            driver._verify_chromium_pin(self.repo, self.src)

    def test_allow_dirty_only_allows_untracked_files(self):
        (self.repo / "packages/browseros/pyproject.toml").touch()
        with mock.patch.object(driver.shutil, "which", return_value="/bin/tool"), \
             mock.patch.object(driver.shutil, "disk_usage", return_value=mock.Mock(free=200 * 1024**3)), \
             mock.patch.object(driver, "_run_capture", side_effect=["feat/aster-linux-ui", "tracked.py"]):
            with self.assertRaisesRegex(RuntimeError, "clean tracked checkout"):
                driver._preflight(self.repo, self.src, provision="none", allow_dirty=True)
        with mock.patch.object(driver.shutil, "which", return_value="/bin/tool"), \
             mock.patch.object(driver.shutil, "disk_usage", return_value=mock.Mock(free=200 * 1024**3)), \
             mock.patch.object(driver, "_run_capture", side_effect=["feat/aster-linux-ui", "", "?? untracked"]), \
             mock.patch.object(driver, "_verify_chromium_pin"):
            driver._preflight(self.repo, self.src, provision="none", allow_dirty=True)


class StagingTest(unittest.TestCase):
    def test_staging_actions_reject_symlinked_output_roots_and_ancestors(self):
        scripts = (
            (
                "server",
                HERE.parent / "chromium_patches/chrome/browser/browseros/server/stage_aster_server.py",
            ),
            (
                "extension",
                HERE.parent / "chromium_patches/chrome/browser/browseros/bundled_extensions/stage_aster_unpacked.py",
            ),
        )
        for kind, patch_path in scripts:
            lines = patch_path.read_text().splitlines()
            script_text = "\n".join(
                line[1:]
                for line in lines
                if line.startswith("+") and not line.startswith("+++")
            ) + "\n"
            for symlink_mode in ("destination", "ancestor"):
                with self.subTest(action=kind, symlink=symlink_mode), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    script = root / "stage.py"
                    script.write_text(script_text)
                    source = root / "input" / (
                        "resources" if kind == "server" else "aster_unpacked_dev"
                    )
                    source.mkdir(parents=True)
                    if kind == "server":
                        for name in ("bin/aster_server", "bin/third_party/bun"):
                            executable = source / name
                            executable.parent.mkdir(parents=True, exist_ok=True)
                            executable.write_text(name)
                            executable.chmod(0o755)
                        target_name = "resources"
                    else:
                        (source / "manifest.json").write_text("{}")
                        (source.parent / "bundled_extensions.json").write_text("{}")
                        target_name = "aster_unpacked_dev"

                    outside = root / "outside"
                    output_root = root / "output"
                    output_root.mkdir()
                    if symlink_mode == "destination":
                        destination = outside / "target"
                        destination.mkdir(parents=True)
                        sentinel = destination / "keep.txt"
                        sentinel.write_text("preserve")
                        target = output_root / target_name
                        target.symlink_to(destination, target_is_directory=True)
                    else:
                        real_parent = outside / "real-parent"
                        target = real_parent / target_name
                        target.parent.mkdir(parents=True)
                        target.mkdir()
                        sentinel = target / "keep.txt"
                        sentinel.write_text("preserve")
                        linked_parent = root / "output-link"
                        linked_parent.symlink_to(real_parent, target_is_directory=True)
                        target = linked_parent / target_name

                    stamp = output_root / "stage.stamp"
                    result = subprocess.run(
                        ["python3", str(script), str(source), str(target), str(stamp)],
                        capture_output=True,
                        text=True,
                    )
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertEqual(sentinel.read_text(), "preserve")

    def test_server_staging_preserves_executable_modes_and_migrations(self):
        patch = HERE.parent / "chromium_patches/chrome/browser/browseros/server/stage_aster_server.py"
        lines = patch.read_text().splitlines()
        script_text = "\n".join(line[1:] for line in lines if line.startswith("+") and not line.startswith("+++")) + "\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "stage.py"
            script.write_text(script_text)
            source = root / "input/resources"
            for name in ("bin/aster_server", "bin/third_party/bun", "migrations/0001.sql"):
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
                if name.startswith("bin/"):
                    path.chmod(0o755)
            target = root / "output/resources"
            subprocess.run(["python3", str(script), str(source), str(target), str(root / "output/stamp")], check=True)
            self.assertTrue((target / "bin/aster_server").stat().st_mode & 0o111)
            self.assertTrue((target / "bin/third_party/bun").stat().st_mode & 0o111)
            self.assertEqual((target / "migrations/0001.sql").read_text(), "migrations/0001.sql")

    def test_action_stages_tree_and_restores_missing_file(self):
        patches = HERE.parent / "chromium_patches/chrome/browser/browseros/bundled_extensions"
        patch_lines = (patches / "stage_aster_unpacked.py").read_text().splitlines()
        source = "\n".join(line[1:] for line in patch_lines if line.startswith("+") and not line.startswith("+++")) + "\n"
        gn = (patches / "BUILD.gn").read_text()
        self.assertIn('outputs += [ "$root_out_dir/browseros_extensions/$source" ]', gn)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "stage.py"
            script.write_text(source)
            source_dir = root / "input/aster_unpacked_dev"
            source_dir.mkdir(parents=True)
            (source_dir / "manifest.json").write_text("{}")
            (source_dir / "nested").mkdir()
            (source_dir / "nested/app.js").write_text("test")
            (source_dir.parent / "bundled_extensions.json").write_text("{}")
            output = root / "output/aster_unpacked_dev"
            stamp = root / "output/aster_unpacked_dev.stamp"
            command = ["python3", str(script), str(source_dir), str(output), str(stamp)]
            subprocess.run(command, check=True)
            self.assertEqual((output / "nested/app.js").read_text(), "test")
            (output / "nested/app.js").unlink()
            subprocess.run(command, check=True)
            self.assertEqual((output / "nested/app.js").read_text(), "test")


if __name__ == "__main__":
    unittest.main()
