# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from odoo_test import (
    OdooTestError,
    changed_addons,
    parse_result,
    require_scratch,
    template_name,
    with_dependents,
)

DEPENDS = {
    'nasq_core': [],
    'nasq_api': ['nasq_core'],
    'nasq_pmo': ['nasq_api'],
    'nasq_hr': ['nasq_api'],
    'nasq_meetings_pmo': ['nasq_meetings', 'nasq_pmo'],
    'nasq_meetings': ['nasq_api'],
}


class TestOdooTest(unittest.TestCase):
    def test_changed_addons_maps_paths_to_known_addons(self):
        paths = ['odoo-addons/nasq_hr/models/x.py', 'docs/a.md', 'odoo-addons/unknown/a.py', 'odoo-addons/README']
        self.assertEqual(changed_addons(paths, set(DEPENDS)), {'nasq_hr'})

    def test_dependents_are_transitive(self):
        self.assertEqual(
            with_dependents({'nasq_pmo'}, DEPENDS),
            {'nasq_pmo', 'nasq_meetings_pmo'},
        )
        self.assertEqual(with_dependents({'nasq_hr'}, DEPENDS), {'nasq_hr'})
        self.assertEqual(with_dependents({'nasq_core'}, DEPENDS), set(DEPENDS))

    def test_only_scratch_databases_are_accepted(self):
        for bad in ('odoo19', 'postgres', 'nasq_test', 'nasq_scratch', 'nasq_scratch_x; drop', 'NASQ_scratch_a'):
            with self.assertRaises(OdooTestError):
                require_scratch(bad)
        self.assertEqual(require_scratch('nasq_scratch_run_ab12'), 'nasq_scratch_run_ab12')

    def test_template_name_changes_with_each_key_part(self):
        base = template_name('c1', ['a', 'b'], 't1')
        self.assertEqual(base, template_name('c1', ['b', 'a'], 't1'))
        self.assertNotEqual(base, template_name('c2', ['a', 'b'], 't1'))
        self.assertNotEqual(base, template_name('c1', ['a'], 't1'))
        self.assertNotEqual(base, template_name('c1', ['a', 'b'], 't2'))
        self.assertTrue(base.startswith('nasq_scratch_tpl_'))

    def test_parse_result_uses_last_line(self):
        log = '... 1 failed, 0 error(s) of 5 tests\n... 0 failed, 2 error(s) of 9 tests\n'
        self.assertEqual(parse_result(log), (0, 2, 9))
        self.assertIsNone(parse_result('nothing here'))


if __name__ == '__main__':
    unittest.main()
