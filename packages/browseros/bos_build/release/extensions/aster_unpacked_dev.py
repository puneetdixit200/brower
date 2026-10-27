#!/usr/bin/env python3
"""Read-only validation for a separately gated Aster Linux debug extension tree.

The signed CRX and release prepared-resource pipeline is intentionally unchanged.
This validator does not stage a browser, configure GN or install an extension.
"""

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from ...core.products import ASTER_EXTENSION_ID

MAX_MANIFEST_BYTES = 1024 * 1024
MAX_FILES = 10000
MAX_BYTES = 512 * 1024 * 1024


@dataclass(frozen=True)
class AsterUnpackedDevelopmentExtension:
    directory: Path
    extension_id: str
    version: str
    files: tuple[str, ...]
    bytes_total: int


def require_aster_unpacked_debug(
    *, product: str, platform: str, build_type: str, is_official_build: bool
) -> None:
    """This is never an ordinary resource or release-signing fallback."""
    if (
        product != "aster"
        or platform != "linux"
        or build_type != "debug"
        or type(is_official_build) is not bool
        or is_official_build
    ):
        raise ValueError(
            "Unpacked development extensions require Aster Linux debug non-official mode"
        )


def _chrome_version(value: object) -> tuple[int, int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", value):
        raise ValueError("Unpacked extension has an invalid Chrome version")
    parts = [int(part) for part in value.split(".")]
    if any(part > 65535 for part in parts):
        raise ValueError("Unpacked extension version exceeds Chrome limits")
    return tuple((parts + [0] * (4 - len(parts))))  # type: ignore[return-value]


def _manifest_id(public_key: object) -> str:
    if not isinstance(public_key, str) or not public_key:
        raise ValueError("Unpacked extension public key is missing")
    try:
        der = base64.b64decode(public_key, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("Unpacked extension public key is not base64 DER") from exc
    # The build's existing WXT identity generator validates DER SPKI. This
    # check requires a plausible DER sequence, then binds its hash to the
    # stable Aster ID. This does not validate cryptographic ownership.
    if len(der) < 64 or der[0] != 0x30:
        raise ValueError("Unpacked extension public key is not DER SPKI")
    digest = hashlib.sha256(der).digest()[:16]
    return "".join(chr(97 + (byte >> 4)) + chr(97 + (byte & 15)) for byte in digest)


def validate_aster_unpacked_debug(
    directory: Path,
    *,
    product: str,
    platform: str,
    build_type: str,
    is_official_build: bool,
    expected_version: str,
) -> AsterUnpackedDevelopmentExtension:
    """Validate expected ID/version, regular files, and a bounded tree.

    No browser installation or output mutation occurs in this function.
    """
    require_aster_unpacked_debug(
        product=product,
        platform=platform,
        build_type=build_type,
        is_official_build=is_official_build,
    )
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Unpacked extension root must be a real directory")
    manifest_path = directory / "manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("Unpacked extension manifest is missing or unsafe")
    if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Unpacked extension manifest is too large")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Unpacked extension manifest is invalid JSON") from exc
    if not isinstance(manifest, dict) or manifest.get("manifest_version") != 3:
        raise ValueError("Unpacked extension requires a Manifest V3 manifest")
    extension_id = _manifest_id(manifest.get("key"))
    if extension_id != ASTER_EXTENSION_ID:
        raise ValueError("Unpacked extension ID does not match Aster development")
    version = manifest.get("version")
    if _chrome_version(version) != _chrome_version(expected_version):
        raise ValueError("Unpacked extension version does not match source")
    if "update_url" in manifest:
        raise ValueError("Unpacked development extensions must not have an update feed")
    # Never silently accept external callers or published web resources from
    # an ambient build environment.
    if manifest.get("externally_connectable") != {"ids": []}:
        raise ValueError("Unpacked development extensions require denied external callers")
    if manifest.get("web_accessible_resources"):
        raise ValueError("Unpacked development extensions expose web resources")

    files: list[str] = []
    bytes_total = 0
    for path in directory.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("Unpacked extension contains a link or special file")
        if path.is_dir():
            continue
        relative = path.relative_to(directory).as_posix()
        files.append(relative)
        bytes_total += path.stat().st_size
        if len(files) > MAX_FILES or bytes_total > MAX_BYTES:
            raise ValueError("Unpacked development extension exceeds size limits")
    if not files or "manifest.json" not in files:
        raise ValueError("Unpacked extension tree is incomplete")
    return AsterUnpackedDevelopmentExtension(
        directory=directory.resolve(),
        extension_id=extension_id,
        version=version,
        files=tuple(sorted(files)),
        bytes_total=bytes_total,
    )
