#!/usr/bin/env python3
"""Prepared common-resource contract tests."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from bos_build.core.products import (
    BROWSEROS_AGENT_EXTENSION_ID,
    BROWSEROS_BUG_REPORTER_EXTENSION_ID,
)
from bos_build.release.prepared_resources import (
    PreparationRequest,
    LocalPreparationOperations,
    load_prepared_resources,
    prepare_common_resources,
    validate_prepared_resources,
)


SOURCE_SHA = "2" * 40
PARENT_SHA = "1" * 40


def _protobuf_field(number: int, payload: bytes) -> bytes:
    key = (number << 3) | 2
    encoded = bytearray()
    while key > 0x7F:
        encoded.append((key & 0x7F) | 0x80)
        key >>= 7
    encoded.append(key)
    length = len(payload)
    while length > 0x7F:
        encoded.append((length & 0x7F) | 0x80)
        length >>= 7
    encoded.append(length)
    return bytes(encoded) + payload


def _crx(extension_id: str, payload: bytes = b"payload") -> bytes:
    crx_id = bytes(
        int(extension_id[index : index + 2].translate(str.maketrans("abcdefghijklmnop", "0123456789abcdef")), 16)
        for index in range(0, 32, 2)
    )
    signed_data = _protobuf_field(1, crx_id)
    header = _protobuf_field(10000, signed_data)
    return b"Cr24" + (3).to_bytes(4, "little") + len(header).to_bytes(4, "little") + header + payload


def _onboarding_zip(path: Path, version: str = "0.0.12") -> None:
    content = b"onboarding"
    metadata = {
        "version": version,
        "target": "universal",
        "files": [
            {
                "path": "resources/index.html",
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
            }
        ],
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("artifact-metadata.json", json.dumps(metadata))
        archive.writestr("resources/index.html", content)


class FakeOperations:
    def __init__(self) -> None:
        self.extension_builds = []
        self.manifest_fetches = 0
        self.downloads = []
        self.onboarding_builds = 0

    def build_product_extension(self, request, destination) -> None:
        self.extension_builds.append((request.product, destination))
        destination.write_bytes(_crx(BROWSEROS_AGENT_EXTENSION_ID, b"agent"))

    def fetch_manifest(self, url: str) -> str:
        self.manifest_fetches += 1
        return (
            '<gupdate xmlns="http://www.google.com/update2/response">'
            f'<app appid="{BROWSEROS_BUG_REPORTER_EXTENSION_ID}">'
            '<updatecheck codebase="https://cdn.browseros.com/bug.crx" '
            'version="54.0.0.0"/></app></gupdate>'
        )

    def download(self, url: str) -> bytes:
        self.downloads.append(url)
        return _crx(BROWSEROS_BUG_REPORTER_EXTENSION_ID, b"bug")

    def build_onboarding(self, destination: Path, component: str) -> None:
        self.onboarding_builds += 1
        _onboarding_zip(destination)


class PreparedResourcesTest(unittest.TestCase):
    def test_prepared_resources_imports_before_pipeline_registry(self) -> None:
        # Regression: a direct import previously failed when this module
        # eagerly imported bos_build.steps.storage.download during initialization.
        package_root = Path(__file__).resolve().parents[2]
        result = subprocess.run(
            [sys.executable, '-c',
             'from bos_build.release.prepared_resources import PreparationRequest; print("ok")'],
            cwd=package_root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "prepared"
        self.request = PreparationRequest(
            product="browseros",
            parent_sha=PARENT_SHA,
            source_sha=SOURCE_SHA,
            browser_version="0.31.0",
            component_versions={
                "server": "0.0.128",
                "agent": "0.0.101.0",
                "app-onboard": "0.0.12",
            },
            output_dir=self.output,
            manifest_url="https://cdn.browseros.com/extensions/bundled-manifest.xml",
        )

    def test_prepares_each_common_resource_once_and_binds_identity(self) -> None:
        operations = FakeOperations()

        manifest = prepare_common_resources(self.request, operations)

        self.assertEqual(len(operations.extension_builds), 1)
        self.assertEqual(operations.manifest_fetches, 1)
        self.assertEqual(len(operations.downloads), 1)
        self.assertEqual(operations.onboarding_builds, 1)
        self.assertEqual(manifest.product, "browseros")
        self.assertEqual(manifest.parent_sha, PARENT_SHA)
        self.assertEqual(manifest.source_sha, SOURCE_SHA)
        self.assertEqual(set(manifest.files), {"product_crx", "bug_reporter_crx", "onboarding"})
        self.assertEqual(
            manifest.files["product_crx"].extension_id,
            BROWSEROS_AGENT_EXTENSION_ID,
        )
        self.assertEqual(
            manifest.files["bug_reporter_crx"].version,
            "54.0.0.0",
        )

    def test_aster_onboarding_builder_uses_local_aster_producer(self) -> None:
        agent_root = self.root / "packages/browseros-agent"
        (agent_root / "apps/app-onboard").mkdir(parents=True)
        (agent_root / "apps/app-onboard/package.json").write_text("{}")
        (agent_root / "bun.lock").write_text("lock")
        archive = (
            agent_root
            / "dist/local/aster-onboard/aster-onboard-resources.zip"
        )
        archive.parent.mkdir(parents=True)
        archive.write_bytes(b"aster archive")
        destination = self.root / "prepared/aster-onboard-resources.zip"
        destination.parent.mkdir()

        with patch("bos_build.release.prepared_resources.subprocess.run") as run:
            LocalPreparationOperations(self.root).build_onboarding(
                destination, "aster-onboard"
            )

        self.assertEqual(destination.read_bytes(), b"aster archive")
        self.assertEqual(
            run.call_args.args[0],
            ["bun", "scripts/build/aster-onboard.ts", "--no-upload"],
        )
        self.assertEqual(run.call_args.kwargs["cwd"], agent_root)

    def test_valid_reuse_performs_no_build_network_or_signing(self) -> None:
        first = FakeOperations()
        expected = prepare_common_resources(self.request, first)
        second = FakeOperations()

        reused = prepare_common_resources(self.request, second)

        self.assertEqual(reused, expected)
        self.assertEqual(second.extension_builds, [])
        self.assertEqual(second.manifest_fetches, 0)
        self.assertEqual(second.downloads, [])
        self.assertEqual(second.onboarding_builds, 0)

    def test_rejects_cross_identity_checksum_and_extra_file(self) -> None:
        prepare_common_resources(self.request, FakeOperations())

        wrong = PreparationRequest(
            **{**self.request.__dict__, "source_sha": "9" * 40}
        )
        with self.assertRaisesRegex(ValueError, "source"):
            validate_prepared_resources(self.output, wrong)

        product_path = self.output / load_prepared_resources(self.output).files["product_crx"].path
        product_path.write_bytes(b"x" * product_path.stat().st_size)
        with self.assertRaisesRegex(ValueError, "checksum"):
            validate_prepared_resources(self.output, self.request)

        prepare_common_resources(self.request, FakeOperations(), rebuild=True)
        (self.output / "stale.bin").write_bytes(b"stale")
        with self.assertRaisesRegex(ValueError, "unexpected"):
            validate_prepared_resources(self.output, self.request)

    def test_rejects_unsafe_paths_before_reading_files(self) -> None:
        prepare_common_resources(self.request, FakeOperations())
        manifest_path = self.output / "prepared-resources.json"
        document = json.loads(manifest_path.read_text())
        document["files"]["product_crx"]["path"] = "../secret"
        manifest_path.write_text(json.dumps(document))

        with self.assertRaisesRegex(ValueError, "unsafe"):
            validate_prepared_resources(self.output, self.request)

    def test_rebuild_clears_stale_files_and_never_serializes_secrets(self) -> None:
        self.output.mkdir()
        (self.output / "stale.bin").write_bytes(b"stale")
        secret = "candidate-signing-secret"
        previous = os.environ.get("BROWSEROS_AGENT_V2_KEY")
        os.environ["BROWSEROS_AGENT_V2_KEY"] = secret
        try:
            prepare_common_resources(self.request, FakeOperations(), rebuild=True)
        finally:
            if previous is None:
                os.environ.pop("BROWSEROS_AGENT_V2_KEY", None)
            else:
                os.environ["BROWSEROS_AGENT_V2_KEY"] = previous

        self.assertFalse((self.output / "stale.bin").exists())
        for path in self.output.rglob("*"):
            if path.is_file():
                self.assertNotIn(secret.encode(), path.read_bytes())


if __name__ == "__main__":
    unittest.main()
