#!/usr/bin/env python3
"""Source-resource catalog tests."""

import unittest

from bos_build.products.resource_sources import source_resources_for_product
from bos_build.products.server_binaries import (
    server_bundles_for_product,
    server_ota_bundles_for_product,
)
from bos_build.release.extensions.specs import spec_by_name


class SourceResourceCatalogTest(unittest.TestCase):
    def test_browseros_source_resources(self) -> None:
        source = source_resources_for_product("browseros")

        self.assertEqual(source.server_component, "server")
        self.assertEqual(source.extension_component, "agent")
        self.assertEqual(source.extension_name, "agent")
        self.assertEqual(source.onboarding_component, "app-onboard")
        self.assertEqual(source.external_extension_names, ("bugreporter",))

    def test_browserclaw_source_resources(self) -> None:
        source = source_resources_for_product("browserclaw")

        self.assertEqual(source.server_component, "claw-server-rust")
        self.assertEqual(source.extension_component, "browserclaw")
        self.assertEqual(source.extension_name, "browserclaw")
        self.assertEqual(source.onboarding_component, "claw-onboard")
        self.assertEqual(source.external_extension_names, ("bugreporter",))

    def test_aster_never_selects_browseros_release_components(self) -> None:
        source = source_resources_for_product("aster")

        self.assertEqual(source.product_id, "aster")
        self.assertEqual(source.server_component, "aster-server")
        self.assertEqual(source.extension_component, "aster-app")
        self.assertEqual(source.extension_name, "aster")
        self.assertEqual(source.onboarding_component, "aster-onboard")
        self.assertEqual(source.external_extension_names, ())
        self.assertEqual(
            tuple(b.id for b in server_bundles_for_product("aster")),
            ("aster-server",),
        )
        self.assertEqual(server_ota_bundles_for_product("aster"), ())
        with self.assertRaisesRegex(ValueError, "Unknown extension 'aster'"):
            spec_by_name(source.extension_name)

    def test_unknown_product_fails(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown product"):
            source_resources_for_product("missing")


if __name__ == "__main__":
    unittest.main()
