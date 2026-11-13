# Part of Odoo. See LICENSE file for full copyright and licensing details.
import errno
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import oca_addons
import odoo_test
from odoo_test import (
    MAX_SHARDS,
    OdooTestError,
    Shard,
    acquire_port,
    changed_addons,
    check_shard_count,
    copy_filestore,
    filestore_dest,
    filestore_src,
    gc_selection,
    local_addons,
    local_depends,
    parse_result,
    report_shards,
    require_scratch,
    shard_outcome,
    split_shards,
    template_name,
    test_weight,
    total_verdict,
    unmanifested_dirs,
    verdict,
    with_dependencies,
    with_dependents,
)

DEPENDS = {
    'liwan_core': [],
    'liwan_api': ['liwan_core'],
    'liwan_pmo': ['liwan_api'],
    'liwan_hr': ['liwan_api'],
    'liwan_meetings_pmo': ['liwan_meetings', 'liwan_pmo'],
    'liwan_meetings': ['liwan_api'],
}


class TestOdooTest(unittest.TestCase):
    def test_changed_addons_maps_paths_to_known_addons(self):
        paths = ['odoo-addons/liwan_hr/models/x.py', 'docs/a.md', 'odoo-addons/unknown/a.py', 'odoo-addons/README']
        self.assertEqual(changed_addons(paths, set(DEPENDS)), {'liwan_hr'})
        self.assertEqual(unmanifested_dirs(paths, set(DEPENDS)), {'unknown'})

    def test_dependents_are_transitive(self):
        self.assertEqual(
            with_dependents({'liwan_pmo'}, DEPENDS),
            {'liwan_pmo', 'liwan_meetings_pmo'},
        )
        self.assertEqual(with_dependents({'liwan_hr'}, DEPENDS), {'liwan_hr'})
        self.assertEqual(with_dependents({'liwan_core'}, DEPENDS), set(DEPENDS))

    def test_only_scratch_databases_are_accepted(self):
        for bad in ('odoo19', 'postgres', 'liwan_test', 'liwan_scratch', 'liwan_scratch_x; drop', 'LIWAN_scratch_a',
                    'liwan_scratch_a\n', 'liwan_tasks_scratch'):
            with self.assertRaises(OdooTestError):
                require_scratch(bad)
        self.assertEqual(require_scratch('liwan_scratch_run_ab12'), 'liwan_scratch_run_ab12')

    def test_template_name_changes_with_each_key_part(self):
        base = template_name('c1', ['a', 'b'], 't1', 'p1')
        self.assertEqual(base, template_name('c1', ['b', 'a'], 't1', 'p1'))
        self.assertNotEqual(base, template_name('c2', ['a', 'b'], 't1', 'p1'))
        self.assertNotEqual(base, template_name('c1', ['a'], 't1', 'p1'))
        self.assertNotEqual(base, template_name('c1', ['a', 'b'], 't2', 'p1'))
        self.assertNotEqual(base, template_name('c1', ['a', 'b'], 't1', 'p2'))
        self.assertTrue(base.startswith('liwan_scratch_tpl_'))

    def test_oca_dirs_fail_closed_when_a_pinned_repository_is_not_fetched(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict('os.environ', {'LIWAN_OCA_DIR': tmp}):
            with self.assertRaisesRegex(odoo_test.OdooTestError, 'oca_addons.py fetch'):
                odoo_test.oca_dirs()

    def test_oca_dirs_return_the_verified_pinned_repositories(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict('os.environ', {'LIWAN_OCA_DIR': tmp}), \
                mock.patch.object(oca_addons, 'verify_all') as verify:
            dirs = odoo_test.oca_dirs()
        verify.assert_called_once()
        self.assertTrue(dirs and all(d.parent == Path(tmp) for d in dirs))

    def test_template_format_is_part_of_the_key(self):
        base = template_name('c1', ['a'], 't1', 'p1')
        old = odoo_test.TEMPLATE_FORMAT
        odoo_test.TEMPLATE_FORMAT = old + 1
        try:
            self.assertNotEqual(base, template_name('c1', ['a'], 't1', 'p1'))
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

    def test_known_includes_non_liwan_addons_and_skips_plain_dirs(self):
        self.addon('vendor_like', ['base'])
        self.addon('liwan_meetings', ['vendor_like', 'mail'])
        (self.root / 'no_manifest').mkdir()
        (self.root / 'README').write_text('x', encoding='utf-8')
        known = local_addons(self.root)
        self.assertEqual(known, {'vendor_like', 'liwan_meetings'})
        depends = local_depends(self.root, known)
        self.assertEqual(depends['liwan_meetings'], ['vendor_like'])
        self.assertEqual(with_dependents({'vendor_like'}, depends), {'vendor_like', 'liwan_meetings'})

    def test_dependency_closure_follows_non_local_dependencies_and_not_dependents(self):
        self.addon('liwan_hr', ['mail', 'payroll'])
        self.addon('liwan_hr_finance', ['liwan_hr', 'liwan_finance'])
        self.addon('liwan_finance', ['account'])
        known = local_addons(self.root)
        self.assertEqual(
            with_dependencies({'liwan_hr_finance'}, self.root, known),
            {'liwan_hr_finance', 'liwan_hr', 'liwan_finance', 'mail', 'payroll', 'account'},
        )
        self.assertEqual(with_dependencies({'liwan_hr'}, self.root, known), {'liwan_hr', 'mail', 'payroll'})
        self.assertNotIn('liwan_hr_finance', with_dependencies({'liwan_hr'}, self.root, known))


class TestFilestoreAndPorts(TempDirCase):
    def test_filestore_paths(self):
        self.assertEqual(
            filestore_src(self.root, 'liwan_scratch_tpl_ab'), self.root / 'liwan_scratch_tpl_ab' / 'filestore')
        self.assertEqual(
            filestore_dest(self.root / 'd', 'liwan_scratch_run_x'),
            self.root / 'd' / 'filestore' / 'liwan_scratch_run_x')
        with self.assertRaises(OdooTestError):
            filestore_dest(self.root, 'odoo19')

    def test_copy_filestore_copies_files_and_requires_a_source(self):
        with self.assertRaises(OdooTestError):
            copy_filestore(self.root, 'liwan_scratch_tpl_ab', self.root / 'data', 'liwan_scratch_run_x')
        src = filestore_src(self.root, 'liwan_scratch_tpl_ab')
        (src / 'ab').mkdir(parents=True)
        (src / 'ab' / 'file').write_text('x', encoding='utf-8')
        count = copy_filestore(self.root, 'liwan_scratch_tpl_ab', self.root / 'data', 'liwan_scratch_run_x')
        self.assertEqual(count, 1)
        self.assertTrue((filestore_dest(self.root / 'data', 'liwan_scratch_run_x') / 'ab' / 'file').is_file())

    def test_port_lock_is_exclusive_until_released(self):
        # This tests real flock ownership, independently of concurrent local HTTP servers.
        with mock.patch.object(odoo_test.socket.socket, 'connect_ex', return_value=errno.ECONNREFUSED):
            ports = range(8197, 8198)
            port, handle = acquire_port(self.root, ports)
            self.assertEqual(port, 8197)
            with self.assertRaises(OdooTestError):
                acquire_port(self.root, ports)
            handle.close()
            port, handle = acquire_port(self.root, ports)
            self.assertEqual(port, 8197)
            handle.close()

    def test_occupied_port_is_rejected_without_retaining_its_lock(self):
        ports = range(8197, 8198)
        with mock.patch.object(odoo_test.socket.socket, 'connect_ex', return_value=0):
            with self.assertRaisesRegex(OdooTestError, 'no free HTTP port'):
                acquire_port(self.root, ports)
        with mock.patch.object(odoo_test.socket.socket, 'connect_ex', return_value=errno.ECONNREFUSED):
            port, handle = acquire_port(self.root, ports)
            self.addCleanup(handle.close)
            self.assertEqual(port, 8197)


class TestGc(unittest.TestCase):
    def test_selection_keeps_current_active_and_foreign_databases(self):
        names = {
            'liwan_scratch_tpl_cur', 'liwan_scratch_tpl_old', 'liwan_scratch_tpl_busy',
            'liwan_scratch_tplb_1', 'liwan_scratch_run_1', 'liwan_scratch_run_busy',
            'liwan_tasks_scratch', 'odoo19', 'liwan_scratch_other',
        }
        active = {'liwan_scratch_tpl_busy', 'liwan_scratch_run_busy'}
        self.assertEqual(
            gc_selection(names, 'liwan_scratch_tpl_cur', active),
            ['liwan_scratch_run_1', 'liwan_scratch_tpl_old', 'liwan_scratch_tplb_1'],
        )


class TestShardSplit(TempDirCase):
    def test_groups_are_balanced_deterministic_and_cover_every_addon_once(self):
        weights = {'a': 100, 'b': 90, 'c': 50, 'd': 40, 'e': 10, 'f': 0}
        groups = split_shards(weights, 2)
        self.assertEqual(groups, split_shards(dict(reversed(list(weights.items()))), 2))
        self.assertEqual(sorted(name for group in groups for name in group), sorted(weights))
        loads = sorted(sum(weights[n] for n in group) for group in groups)
        self.assertEqual(loads, [140, 150])

    def test_never_more_groups_than_addons_with_tests(self):
        self.assertEqual(split_shards({'a': 5, 'b': 0, 'c': 0}, 4), [['a', 'b', 'c']])
        self.assertEqual(split_shards({'a': 5, 'b': 3}, 4), [['a'], ['b']])
        self.assertEqual(split_shards({'a': 0}, 3), [['a']])
        self.assertEqual(split_shards({'a': 5, 'b': 3}, 1), [['a', 'b']])

    def test_shard_count_is_capped(self):
        self.assertEqual(check_shard_count(MAX_SHARDS), MAX_SHARDS)
        for bad in (0, -1, MAX_SHARDS + 1):
            with self.assertRaisesRegex(OdooTestError, '--shards'):
                check_shard_count(bad)

    def test_weight_counts_test_lines_and_is_zero_without_tests(self):
        tests = self.root / 'liwan_a' / 'tests'
        (tests / 'sub').mkdir(parents=True)
        (tests / 'test_x.py').write_text('a\nb\n', encoding='utf-8')
        (tests / 'sub' / 'test_y.py').write_text('c\n', encoding='utf-8')
        (self.root / 'liwan_b').mkdir()
        self.assertEqual(test_weight(self.root, 'liwan_a'), 3)
        self.assertEqual(test_weight(self.root, 'liwan_b'), 0)


class TestShardResults(TempDirCase):
    def shards(self, count):
        return [Shard(i, count, ['liwan_a%d' % i], self.root) for i in range(1, count + 1)]

    def test_shard_databases_are_scratch_names_gc_can_collect(self):
        shards = self.shards(3)
        for shard in shards:
            self.assertTrue(odoo_test.SCRATCH_DB.fullmatch(shard.database))
            self.assertTrue(odoo_test.GC_DB.fullmatch(shard.database))
            self.assertTrue((shard.workdir / 'data').is_dir())
        self.assertEqual(len({s.database for s in shards}), 3)

    def test_a_shard_with_zero_tests_passes_but_a_run_with_zero_tests_does_not(self):
        self.assertEqual(shard_outcome(0, (0, 0, 0)), (True, ''))
        self.assertEqual(total_verdict([(0, 0, 0), (0, 0, 0)])[0], False)
        self.assertEqual(total_verdict([(0, 0, 0), (0, 0, 7)]), (True, ''))
        self.assertFalse(shard_outcome(0, (1, 0, 4))[0])
        self.assertFalse(shard_outcome(0, (0, 2, 4))[0])
        self.assertFalse(shard_outcome(1, (0, 0, 4))[0])
        self.assertFalse(shard_outcome(0, None)[0])

    def report(self, outcomes):
        shards = self.shards(len(outcomes))
        with mock.patch.object(odoo_test.sys, 'stdout') as out:
            ok = report_shards(shards, outcomes, self.root)
        return ok, ''.join(call.args[0] for call in out.write.call_args_list)

    def test_report_totals_every_shard_and_passes_when_all_pass(self):
        ok, text = self.report([(0, '', '', (0, 0, 3)), (0, '', '', (0, 0, 4))])
        self.assertTrue(ok)
        self.assertIn('shard 1/2: 3 tests', text)
        self.assertIn('total: 7 tests, 0 failed, 0 errors in 2 shard(s)', text)

    def test_report_fails_when_any_shard_fails_and_names_its_log(self):
        ok, text = self.report([(0, '', '', (0, 0, 3)), (1, 'x ERROR boom\n', '', (1, 0, 4))])
        self.assertFalse(ok)
        self.assertIn('FAILED shard 2/2: 1 failed, 0 errors', text)
        self.assertIn(str(self.root / 'last-failure-shard-2.log'), text)
        self.assertEqual((self.root / 'last-failure-shard-2.log').read_text(encoding='utf-8'), 'x ERROR boom\n')
        self.assertFalse((self.root / 'last-failure-shard-1.log').exists())

    def test_report_fails_a_shard_without_a_result_line(self):
        ok, text = self.report([(0, '', '', (0, 0, 3)), (2, 'tail line\n', '', None)])
        self.assertFalse(ok)
        self.assertIn('no test result line', text)
        self.assertNotIn('total:', text)

    def test_report_fails_when_no_test_ran_at_all(self):
        ok, text = self.report([(0, '', '', (0, 0, 0))])
        self.assertFalse(ok)
        self.assertIn('zero tests ran', text)


if __name__ == '__main__':
    unittest.main()
