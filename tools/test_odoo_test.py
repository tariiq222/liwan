# Part of Odoo. See LICENSE file for full copyright and licensing details.
import tempfile
import unittest
from pathlib import Path

import odoo_test
from odoo_test import (
    OdooTestError,
    acquire_port,
    changed_addons,
    copy_filestore,
    filestore_dest,
    filestore_src,
    gc_selection,
    local_addons,
    local_depends,
    parse_result,
    require_scratch,
    template_name,
    unmanifested_dirs,
    verdict,
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
        self.assertEqual(unmanifested_dirs(paths, set(DEPENDS)), {'unknown'})

    def test_dependents_are_transitive(self):
        self.assertEqual(
            with_dependents({'nasq_pmo'}, DEPENDS),
            {'nasq_pmo', 'nasq_meetings_pmo'},
        )
        self.assertEqual(with_dependents({'nasq_hr'}, DEPENDS), {'nasq_hr'})
        self.assertEqual(with_dependents({'nasq_core'}, DEPENDS), set(DEPENDS))

    def test_only_scratch_databases_are_accepted(self):
        for bad in ('odoo19', 'postgres', 'nasq_test', 'nasq_scratch', 'nasq_scratch_x; drop', 'NASQ_scratch_a',
                    'nasq_scratch_a\n', 'nasq_tasks_scratch'):
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

    def test_template_format_is_part_of_the_key(self):
        base = template_name('c1', ['a'], 't1')
        old = odoo_test.TEMPLATE_FORMAT
        odoo_test.TEMPLATE_FORMAT = old + 1
        try:
            self.assertNotEqual(base, template_name('c1', ['a'], 't1'))
        finally:
            odoo_test.TEMPLATE_FORMAT = old

    def test_parse_result_uses_last_line(self):
        log = '... 1 failed, 0 error(s) of 5 tests\n... 0 failed, 2 error(s) of 9 tests\n'
        self.assertEqual(parse_result(log), (0, 2, 9))
        self.assertIsNone(parse_result('nothing here'))

    def test_zero_tests_is_a_failure(self):
        self.assertFalse(verdict((0, 0, 0))[0])
        self.assertIn('zero tests', verdict((0, 0, 0))[1])
        self.assertFalse(verdict((1, 0, 5))[0])
        self.assertFalse(verdict((0, 2, 5))[0])
        self.assertEqual(verdict((0, 0, 5)), (True, ''))


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)


class TestAddonTree(TempDirCase):
    def addon(self, name, depends):
        folder = self.root / name
        folder.mkdir()
        (folder / '__manifest__.py').write_text("{'name': '%s', 'depends': %r}" % (name, depends), encoding='utf-8')

    def test_known_includes_non_nasq_addons_and_skips_plain_dirs(self):
        self.addon('cyan_like', ['base'])
        self.addon('nasq_meetings', ['cyan_like', 'mail'])
        (self.root / 'no_manifest').mkdir()
        (self.root / 'README').write_text('x', encoding='utf-8')
        known = local_addons(self.root)
        self.assertEqual(known, {'cyan_like', 'nasq_meetings'})
        depends = local_depends(self.root, known)
        self.assertEqual(depends['nasq_meetings'], ['cyan_like'])
        self.assertEqual(with_dependents({'cyan_like'}, depends), {'cyan_like', 'nasq_meetings'})


class TestFilestoreAndPorts(TempDirCase):
    def test_filestore_paths(self):
        self.assertEqual(
            filestore_src(self.root, 'nasq_scratch_tpl_ab'), self.root / 'nasq_scratch_tpl_ab' / 'filestore')
        self.assertEqual(
            filestore_dest(self.root / 'd', 'nasq_scratch_run_x'),
            self.root / 'd' / 'filestore' / 'nasq_scratch_run_x')
        with self.assertRaises(OdooTestError):
            filestore_dest(self.root, 'odoo19')

    def test_copy_filestore_copies_files_and_requires_a_source(self):
        with self.assertRaises(OdooTestError):
            copy_filestore(self.root, 'nasq_scratch_tpl_ab', self.root / 'data', 'nasq_scratch_run_x')
        src = filestore_src(self.root, 'nasq_scratch_tpl_ab')
        (src / 'ab').mkdir(parents=True)
        (src / 'ab' / 'file').write_text('x', encoding='utf-8')
        count = copy_filestore(self.root, 'nasq_scratch_tpl_ab', self.root / 'data', 'nasq_scratch_run_x')
        self.assertEqual(count, 1)
        self.assertTrue((filestore_dest(self.root / 'data', 'nasq_scratch_run_x') / 'ab' / 'file').is_file())

    def test_port_lock_is_exclusive_until_released(self):
        ports = range(8197, 8198)
        port, handle = acquire_port(self.root, ports)
        self.assertEqual(port, 8197)
        with self.assertRaises(OdooTestError):
            acquire_port(self.root, ports)
        handle.close()
        port, handle = acquire_port(self.root, ports)
        self.assertEqual(port, 8197)
        handle.close()


class TestGc(unittest.TestCase):
    def test_selection_keeps_current_active_and_foreign_databases(self):
        names = {
            'nasq_scratch_tpl_cur', 'nasq_scratch_tpl_old', 'nasq_scratch_tpl_busy',
            'nasq_scratch_tplb_1', 'nasq_scratch_run_1', 'nasq_scratch_run_busy',
            'nasq_tasks_scratch', 'odoo19', 'nasq_scratch_other',
        }
        active = {'nasq_scratch_tpl_busy', 'nasq_scratch_run_busy'}
        self.assertEqual(
            gc_selection(names, 'nasq_scratch_tpl_cur', active),
            ['nasq_scratch_run_1', 'nasq_scratch_tpl_old', 'nasq_scratch_tplb_1'],
        )


if __name__ == '__main__':
    unittest.main()
