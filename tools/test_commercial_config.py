# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'odoo-addons/liwan_platform/commercial_config.py'
spec = importlib.util.spec_from_file_location('commercial_config', SOURCE)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class TestCommercialConfig(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'classification.json'
        self.mapping = {
            'schema_version': 1, 'database': 'liwan_mapping_scratch',
            'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }
        self.env = patch.dict(os.environ, {config.CONFIG_ENV: str(self.path)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def load(self, **updates):
        self.path.write_text(json.dumps({**self.mapping, **updates}))
        return config.load_classification('liwan_mapping_scratch')

    def test_explicit_pairs(self):
        self.assertEqual(self.load()['commercial_mode'], 'non_saas')
        self.assertEqual(self.load(commercial_mode='saas', entitlement_source='control_plane')['commercial_mode'], 'saas')

    def test_missing_and_relative_file(self):
        for value in ('', 'relative.json'):
            with self.subTest(value=value), patch.dict(os.environ, {config.CONFIG_ENV: value}):
                with self.assertRaises(ValueError):
                    config.load_classification('liwan_mapping_scratch')

    def test_invalid_mapping(self):
        for update in (
            {'schema_version': True}, {'schema_version': 2}, {'database': 'odoo19'},
            {'commercial_mode': 'government'}, {'commercial_mode': []},
            {'entitlement_source': 'control_plane'}, {'unexpected': True},
            {'valid_until_action': 'guess'}, {'expected_valid_until': '2020-01-01'},
            {'expected_valid_until': 'bad'}, {'expected_valid_until': True},
        ):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.load(**update)

    def test_duplicate_and_oversize(self):
        for raw in ('{"database": "a", "database": "b"}', 'x' * 16385):
            self.path.write_text(raw)
            with self.assertRaises(ValueError):
                config.load_classification('liwan_mapping_scratch')

    def test_clear_requires_matching_cutoff(self):
        self.mapping.update(expected_valid_until='2026-01-01', valid_until_action='clear')
        self.path.write_text(json.dumps(self.mapping))
        self.assertTrue(config.load_classification('liwan_mapping_scratch', date(2026, 1, 1))['clear_valid_until'])
        with self.assertRaises(ValueError):
            config.load_classification('liwan_mapping_scratch', date(2026, 1, 2))

    def test_non_saas_cannot_preserve_cutoff(self):
        self.mapping.update(expected_valid_until='2026-01-01')
        self.path.write_text(json.dumps(self.mapping))
        with self.assertRaises(ValueError):
            config.load_classification('liwan_mapping_scratch', date(2026, 1, 1))

    def test_saas_cannot_clear_cutoff(self):
        with self.assertRaises(ValueError):
            self.load(commercial_mode='saas', entitlement_source='control_plane', valid_until_action='clear')


if __name__ == '__main__':
    unittest.main()
