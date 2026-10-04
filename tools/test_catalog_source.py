# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-version catalog source resolution by sha256 (no Odoo, DB or network)."""
import hashlib
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


if __name__ == '__main__':
    unittest.main()
