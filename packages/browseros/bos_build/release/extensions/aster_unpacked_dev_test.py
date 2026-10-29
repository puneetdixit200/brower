#!/usr/bin/env python3
"""Focused validation tests; no native Chromium sources or signed keys required."""

import json
import tempfile
import unittest
from pathlib import Path

from bos_build.release.extensions.aster_unpacked_dev import (
    validate_aster_unpacked_debug,
)

# Public development identity from apps/app/lib/build/aster-manifest-identity.ts.
PUBLIC_DEVELOPMENT_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2gIwa9N2/RqO1TGyeOHS0uS9xDkYnnFIuDym99e8uFA6lc1t6JLeWTmi6GxpKqFejoTA1/4Wiuh1A3v/3FOqCCjDzaEFmhb0H2Z7FdvfEOpBtmMBmQDfTcPk1gdxn1cviHjTwOStoSSnQAy/NhJ6J5uvUjK74C/8FoGQ5HzPzrNWMdsKxsGK/8knXwif5gK1zAppGzdh0wmfbqD2xPKTD89XE6so+vIP1bvGSUIWVfxqZisa7zfW3wLKw+AX4IA6SOTx/vhI0HxQeZkjlLPyF3PEVA4uMdItbpsVRPySgQz2zkqwPnRcG+QCTiQxTeXqlnXsHxHi3G00wJDqCIZoLwIDAQAB"
EXPECTED_EXTENSION_ID = "oifdmombnijnaiocijiacjhajbnpdlhb"


class AsterUnpackedDevelopmentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / "extension"
        self.directory.mkdir()
        self.manifest = {
            "manifest_version": 3,
            "name": "Aster Browser",
            "version": "0.0.161",
            "key": PUBLIC_DEVELOPMENT_KEY,
            "externally_connectable": {"ids": []},
        }
        self._write()
        (self.directory / "app.html").write_text("<html></html>")

    def _write(self) -> None:
        (self.directory / "manifest.json").write_text(json.dumps(self.manifest))

    def _validate(self, **overrides):
        settings = dict(
            product="aster",
            platform="linux",
            build_type="debug",
            is_official_build=False,
            expected_version="0.0.161.0",
        )
        settings.update(overrides)
        return validate_aster_unpacked_debug(self.directory, **settings)

    def test_accepts_aster_development_public_identity(self):
        result = self._validate()
        self.assertEqual(result.extension_id, EXPECTED_EXTENSION_ID)
        self.assertIn("app.html", result.files)
        self.assertEqual(result.version, "0.0.161")

    def test_denies_release_other_products_platforms_and_official_build(self):
        for key, value in (
            ("product", "browseros"),
            ("platform", "macos"),
            ("build_type", "release"),
            ("is_official_build", True),
            ("is_official_build", "false"),
        ):
            with self.subTest(key=key, value=value), self.assertRaisesRegex(
                ValueError, "Aster Linux debug"
            ):
                self._validate(**{key: value})

    def test_rejects_wrong_public_key_id(self):
        self.manifest["key"] = "AA=="
        self._write()
        with self.assertRaisesRegex(ValueError, "DER SPKI"):
            self._validate()

    def test_rejects_missing_or_wrong_version(self):
        for version in (None, "0.0.160", "1.2.3.4.5", "9999999"):
            with self.subTest(version=version):
                if version is None:
                    self.manifest.pop("version", None)
                else:
                    self.manifest["version"] = version
                self._write()
                with self.assertRaises(ValueError):
                    self._validate()

    def test_rejects_release_feed_external_permissions_and_web_resources(self):
        for field, value in (
            ("update_url", "https://example.invalid/feed.xml"),
            ("externally_connectable", {"ids": ["a" * 32]}),
            ("web_accessible_resources", [{"resources": ["*"], "matches": ["<all_urls>"]}]),
        ):
            with self.subTest(field=field):
                self.manifest[field] = value
                self._write()
                with self.assertRaises(ValueError):
                    self._validate()
                del self.manifest[field]
                self.manifest["externally_connectable"] = {"ids": []}
                self._write()

    def test_rejects_symlinks_and_missing_manifest(self):
        (self.directory / "linked").symlink_to(self.directory / "app.html")
        with self.assertRaisesRegex(ValueError, "link"):
            self._validate()
        (self.directory / "linked").unlink()
        (self.directory / "manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "manifest"):
            self._validate()

    def test_rejects_filenames_unsafe_for_generated_gn_list(self):
        for name in ('bad"name.js', "$evil.js", "bad name.js", "bad\nname.js"):
            with self.subTest(name=name):
                path = self.directory / name
                path.write_text("payload")
                with self.assertRaisesRegex(ValueError, "unsafe GN filename"):
                    self._validate()
                path.unlink()

    def test_accepts_wxt_font_filename_in_gn_list(self):
        font = self.directory / "geist-mono/GeistMono-Italic[wght].woff2"
        font.parent.mkdir()
        font.write_bytes(b"font")

        result = self._validate()

        self.assertIn("geist-mono/GeistMono-Italic[wght].woff2", result.files)


if __name__ == "__main__":
    unittest.main()
