import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from install_omarchy_aster_launcher import (
    DESKTOP_NAME,
    IDENTIFIER,
    ICON_MANAGED,
    install,
    uninstall,
)


class LauncherOwnershipTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        tmp_path = Path(self.temp.name)
        data_home = tmp_path / "xdg-data"
        home = tmp_path / "home"
        home.mkdir()
        self.environment = patch.dict(
            "os.environ", {"HOME": str(home), "XDG_DATA_HOME": str(data_home)}
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        # Representative user-owned settings that a launcher installer must not
        # rewrite, even when they mention another browser.
        protected = {
            home / ".config/hypr/hyprland.conf": b"bind = SUPER, B, exec, firefox\n",
            data_home / "applications/mimeapps.list": (
                b"[Default Applications]\ntext/html=firefox.desktop\n"
            ),
        }
        for path, contents in protected.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)

        binary = tmp_path / "aster"
        binary.write_bytes(b"#!/bin/sh\nexit 0\n")
        binary.chmod(0o755)
        icon = tmp_path / "aster.svg"
        icon.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>\n')
        self.data_home = data_home
        self.protected = protected
        self.binary = binary
        self.icon = icon

    def test_install_and_uninstall_only_change_aster_owned_xdg_files(self):
        data_home = self.data_home
        protected = self.protected
        binary = self.binary
        icon = self.icon
        original = {path: path.read_bytes() for path in protected}
        desktop = data_home / "applications" / DESKTOP_NAME
        icon_dest = data_home / "icons/hicolor/scalable/apps" / f"{IDENTIFIER}.svg"

        install(binary, icon, replace_managed=False)

        self.assertTrue(desktop.is_file())
        self.assertIn(b"X-Aster-Managed=true", desktop.read_bytes())
        self.assertTrue(icon_dest.is_file())
        self.assertIn(ICON_MANAGED, icon_dest.read_bytes())
        self.assertEqual({path: path.read_bytes() for path in protected}, original)
        files_after_install = sorted(
            path.relative_to(data_home).as_posix()
            for path in data_home.rglob("*")
            if path.is_file()
        )
        self.assertEqual(
            files_after_install,
            [
                "applications/aster-browser-debug.desktop",
                "applications/mimeapps.list",
                "icons/hicolor/scalable/apps/aster-browser-debug.svg",
            ],
        )

        uninstall()

        self.assertFalse(desktop.exists())
        self.assertFalse(icon_dest.exists())
        self.assertEqual({path: path.read_bytes() for path in protected}, original)
        remaining_files = [
            path.relative_to(data_home).as_posix()
            for path in data_home.rglob("*")
            if path.is_file()
        ]
        self.assertEqual(remaining_files, ["applications/mimeapps.list"])

    def test_install_refuses_to_overwrite_unowned_icon(self):
        data_home, binary, icon = self.data_home, self.binary, self.icon
        icon_dest = data_home / "icons/hicolor/scalable/apps" / f"{IDENTIFIER}.svg"
        icon_dest.parent.mkdir(parents=True)
        icon_dest.write_text("user icon\n")

        with self.assertRaisesRegex(ValueError, "icon not owned by Aster"):
            install(binary, icon, replace_managed=False)

        self.assertEqual(icon_dest.read_text(), "user icon\n")
        self.assertFalse((data_home / "applications" / DESKTOP_NAME).exists())

    def test_install_with_managed_desktop_symlink_leaves_icon_unchanged(self):
        data_home = self.data_home
        desktop = data_home / "applications" / DESKTOP_NAME
        icon_dest = data_home / "icons/hicolor/scalable/apps" / f"{IDENTIFIER}.svg"
        desktop.parent.mkdir(parents=True, exist_ok=True)
        target = desktop.parent / "managed-target.desktop"
        target.write_text(f"[Desktop Entry]\nX-Aster-Managed=true\n")
        desktop.symlink_to(target)
        icon_dest.parent.mkdir(parents=True)
        icon_dest.write_bytes(b"existing managed icon\n" + ICON_MANAGED)
        original_icon = icon_dest.read_bytes()

        with self.assertRaisesRegex(ValueError, "symlinked launcher"):
            install(self.binary, self.icon, replace_managed=True)

        self.assertEqual(icon_dest.read_bytes(), original_icon)
        self.assertTrue(desktop.is_symlink())
        self.assertEqual(target.read_text(), "[Desktop Entry]\nX-Aster-Managed=true\n")

    def test_install_refuses_icon_symlink_without_modifying_target(self):
        data_home = self.data_home
        icon_dest = data_home / "icons/hicolor/scalable/apps" / f"{IDENTIFIER}.svg"
        icon_dest.parent.mkdir(parents=True)
        target = Path(self.temp.name) / "user-icon.svg"
        target.write_text("user icon\n")
        icon_dest.symlink_to(target)

        with self.assertRaisesRegex(ValueError, "icon not owned by Aster"):
            install(self.binary, self.icon, replace_managed=False)

        self.assertEqual(target.read_text(), "user icon\n")
        self.assertTrue(icon_dest.is_symlink())
        self.assertFalse((data_home / "applications" / DESKTOP_NAME).exists())

    def test_uninstall_preserves_unowned_icon_even_with_managed_launcher(self):
        data_home = self.data_home
        desktop = data_home / "applications" / DESKTOP_NAME
        icon_dest = data_home / "icons/hicolor/scalable/apps" / f"{IDENTIFIER}.svg"
        desktop.parent.mkdir(parents=True, exist_ok=True)
        desktop.write_text(f"[Desktop Entry]\n{'X-Aster-Managed=true'}\n")
        icon_dest.parent.mkdir(parents=True)
        icon_dest.write_text("user icon\n")

        uninstall()

        self.assertFalse(desktop.exists())
        self.assertEqual(icon_dest.read_text(), "user icon\n")

if __name__ == "__main__":
    unittest.main()
