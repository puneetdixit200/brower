#!/usr/bin/env python3
"""Aster product identity for native build planning and Linux packaging."""

from pathlib import Path

from ...core.products import (
    ASTER_EXTENSION_ID,
    MacProductIdentity,
    ProductDescriptor,
    WindowsProductIdentity,
)
from ..server_binaries import ServerBundle


ASTER_PRODUCT = ProductDescriptor.define(
    id="aster",
    display_name="Aster Browser",
    # Cross-platform identity fields are schema-required placeholders. The
    # invalid DNS suffix and all-zero Windows GUID are intentionally unusable;
    # supported_platforms prevents those targets from entering build plans.
    windows_installer_guid="{00000000-0000-0000-0000-000000000000}",
    summary="A Chromium browser with an Aster AI workspace",
    description="Aster Browser is a Chromium-based browser with an AI workspace.",
    company="Aster",
    homepage_url="",
    support_url="",
    bugtracker_url="",
    required_extensions=((ASTER_EXTENSION_ID, "Aster app"),),
    server_bundle_ids=("aster-server",),
    artifact_prefix="Aster_Browser",
    supported_platforms=("linux",),
    mac=MacProductIdentity(
        bundle_id="org.aster.invalid.AsterBrowser",
        dev_bundle_id="org.aster.invalid.dev.AsterBrowser",
        signing_identifier="org.aster.invalid.AsterBrowser",
        dev_signing_identifier="org.aster.invalid.dev.AsterBrowser",
        framework_name="AsterBrowser Unsupported.framework",
        dev_framework_name="AsterBrowser Dev Unsupported.framework",
        dmg_volume_name="Aster Browser Unsupported",
    ),
    windows=WindowsProductIdentity(
        app_user_model_id="Aster.Unsupported",
        installer_app_id="{00000000-0000-0000-0000-000000000000}",
    ),
    string_replacements=(
        (r"Google Chrome", "Aster Browser"),
        (r"(?<!The )Chromium", "Aster Browser"),
        (r"Chrome", "Aster Browser"),
    ),
)

# Aster's Linux development server is built from the shared compiled bootstrap,
# but owns distinct output and staged-resource identities. Release publication
# stays disabled until Aster's external release identity is provisioned.
ASTER_SERVER_BUNDLE = ServerBundle(
    id="aster-server",
    name="Aster Server",
    product_ids=("aster",),
    chromium_output_root="AsterServer",
    local_resources_root=Path("resources/binaries/aster_server"),
    chromium_resources_root=Path(
        "chrome/browser/browseros/aster_server/resources"
    ),
    macos_bundle_resources_root=Path(
        "Contents/Resources/AsterServer/default/resources"
    ),
    windows_bundle_resources_root=Path("AsterServer/default/resources"),
    macos_binaries={},
    windows_binaries=(),
    source_builder="bun",
    source_component="aster-server",
    runtime_binary_name="aster_server",
    unsigned_artifact_prefix="artifacts/aster-server",
    unsigned_artifact_base_name="aster-server-resources",
    supported_targets=("linux-x64",),
    ota_enabled=False,
)
