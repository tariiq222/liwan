# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-version catalog source resolution by sha256 (no Odoo, DB or network)."""
import hashlib
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from nasq_cli import catalog_source

ROOT = Path(__file__).resolve().parents[1]
SOLUTIONS = ROOT / 'deploy/catalog/solutions'


def digest(name):
    return hashlib.sha256((SOLUTIONS / name).read_bytes()).hexdigest()


class CatalogSourceTests(unittest.TestCase):
    def test_legacy_and_v2_resolve_to_their_own_files(self):
        self.assertEqual(catalog_source.resolve_catalog_path(digest('platform.json')).name, 'platform.json')
        self.assertEqual(catalog_source.resolve_catalog_path('sha256:' + digest('platform_v2.json')).name,
                         'platform_v2.json')
        self.assertNotEqual(digest('platform.json'), digest('platform_v2.json'))

    def test_zero_match_and_malformed_digest_are_unavailable(self):
        for value in ('0' * 64, 'xyz', None):
            with self.assertRaises(catalog_source.CatalogSourceError) as caught:
                catalog_source.resolve_catalog_path(value)
            self.assertEqual(caught.exception.code, 'catalog_source_unavailable')

    def test_duplicate_bytes_are_ambiguous(self):
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw) / 'deploy/catalog/solutions'
            base.mkdir(parents=True)
            shutil.copy(SOLUTIONS / 'platform.json', base / 'platform.json')
            shutil.copy(SOLUTIONS / 'platform.json', base / 'platform_v2.json')
            with self.assertRaises(catalog_source.CatalogSourceError) as caught:
                catalog_source.resolve_catalog_path(digest('platform.json'), Path(raw))
            self.assertEqual(caught.exception.code, 'catalog_source_ambiguous')

    def test_v3_and_v4_resolve_to_their_own_files_and_v4_is_registered_last(self):
        self.assertEqual(catalog_source.resolve_catalog_path(digest('platform_v3.json')).name, 'platform_v3.json')
        self.assertEqual(catalog_source.resolve_catalog_path(digest('platform_v4.json')).name, 'platform_v4.json')
        self.assertEqual(catalog_source.KNOWN_SOURCES[-1], 'platform_v4.json')

    def test_registry_matches_the_solution_files_and_the_control_plane_copy(self):
        # KNOWN_SOURCES stays an explicit registry (a published row pins a file's digest);
        # a new platform*.json must be registered in Python and TypeScript together.
        on_disk = sorted(path.name for path in SOLUTIONS.glob('platform*.json'))
        self.assertEqual(list(catalog_source.KNOWN_SOURCES), on_disk)
        ts = (Path(__file__).resolve().parents[1] / 'apps/control-plane/src/shared/catalog-source.ts').read_text()
        listed = re.search(r'KNOWN_SOURCES = \[([^\]]*)\]', ts)
        self.assertIsNotNone(listed)
        self.assertEqual(re.findall(r"'([^']+)'", listed.group(1)), list(catalog_source.KNOWN_SOURCES))


if __name__ == '__main__':
    unittest.main()
