"""The comparison half of tools/contract_fixtures.py: structure, not bytes, and nothing compared is a failure."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import contract_fixtures


class CompareTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.committed = self.root / 'committed'
        self.fresh = self.root / 'fresh'
        for directory in (self.committed, self.fresh):
            directory.mkdir()
        manifest = [{'name': 'app/list', 'addon': 'liwan_a'}, {'name': 'app/detail', 'addon': 'liwan_b'},
                    {'name': 'other/list', 'addon': 'liwan_a'}]
        (self.committed / 'manifest.json').write_text(json.dumps({'fixtures': manifest}))
        patcher = mock.patch.object(contract_fixtures, 'FIXTURES', self.committed)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, directory, name, value):
        target = directory / (name + '.json')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value))

    def both(self, value, fresh=None):
        for name in ('app/list', 'app/detail', 'other/list'):
            self.write(self.committed, name, value)
            self.write(self.fresh, name, value if fresh is None else fresh)

    def run_compare(self, directory):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            return contract_fixtures.main(['--compare', str(directory)]), err.getvalue()

    def test_the_addons_come_from_the_manifest(self):
        self.assertEqual(contract_fixtures.fixture_addons(), ['liwan_a', 'liwan_b'])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(contract_fixtures.main(['--addons']), 0)
        self.assertEqual(out.getvalue(), 'liwan_a,liwan_b\n')

    def test_changed_values_with_the_same_structure_pass(self):
        self.both({'items': [{'id': 1, 'name': 'a', 'due': None}], 'total': 1},
                  {'items': [{'id': 9, 'name': 'b', 'due': None}, {'id': 2, 'name': 'c', 'due': None}], 'total': 2})
        self.assertEqual(self.run_compare(self.fresh), (0, ''))

    def test_an_added_removed_or_retyped_key_fails(self):
        for fresh in ({'id': 1, 'extra': 1}, {}, {'id': 'x'}, {'id': None}):
            with self.subTest(fresh=fresh):
                self.both({'id': 1}, fresh)
                code, err = self.run_compare(self.fresh)
                self.assertEqual(code, 1)
                self.assertIn('app/list.json: structure differs', err)

    def test_a_route_the_tests_did_not_record_fails(self):
        self.both({'id': 1})
        (self.fresh / 'app' / 'detail.json').unlink()
        code, err = self.run_compare(self.fresh)
        self.assertEqual(code, 1)
        self.assertIn('app/detail.json: the Odoo tests did not record this route', err)

    def test_an_empty_or_missing_directory_fails(self):
        self.both({'id': 1})
        (self.root / 'empty').mkdir()
        for directory in (self.root / 'empty', self.root / 'absent'):
            with self.subTest(directory=directory.name):
                code, err = self.run_compare(directory)
                self.assertEqual(code, 1)
                self.assertEqual(err.count('did not record this route'), 3)

    def test_a_fixture_without_a_manifest_entry_fails(self):
        self.both({'id': 1})
        self.write(self.fresh, 'app/stray', {'id': 1})
        code, err = self.run_compare(self.fresh)
        self.assertEqual(code, 1)
        self.assertIn('app/stray.json: no manifest entry', err)

    def test_an_empty_manifest_compares_nothing_and_fails(self):
        (self.committed / 'manifest.json').write_text(json.dumps({'fixtures': []}))
        code, err = self.run_compare(self.fresh)
        self.assertEqual(code, 1)
        self.assertIn('nothing was compared', err)


if __name__ == '__main__':
    unittest.main()
