"""The application and bridge isolation runs: what they install and what they must not."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import app_isolation

RANKS = {'liwan_core': 0, 'liwan_platform': 1, 'liwan_api': 2, 'liwan_directory': 3, 'liwan_ai': 3,
         'app_a': 4, 'app_b': 4, 'app_c': 4, 'a_b': 5, 'b_ai': 5, 'api_c': 5}
DEPENDS = {'liwan_api': ['liwan_platform'], 'app_a': ['liwan_api', 'project'], 'app_b': ['liwan_api', 'liwan_directory'], 'app_c': ['liwan_api'],
           'a_b': ['app_a', 'app_b'], 'b_ai': ['app_b', 'liwan_ai', 'mail'], 'api_c': ['liwan_api', 'app_c']}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.layers = root / 'arch_layers.json'
        self.layers.write_text(json.dumps({'ranks': RANKS}))
        self.addons = root / 'addons'
        for module, depends in DEPENDS.items():
            (self.addons / module).mkdir(parents=True)
            (self.addons / module / '__manifest__.py').write_text(repr({'name': module, 'depends': depends}))

    def install(self, module):
        return app_isolation.install_list(module, self.layers, self.addons)

    def check(self, module, installed):
        app_isolation.check(module, set(installed), self.layers, self.addons)


class InstallListTest(Fixture):
    def test_an_application_installs_alone(self):
        self.assertEqual(self.install('app_a'), ['app_a'])

    def test_a_bridge_installs_its_two_liwan_sides(self):
        self.assertEqual(self.install('a_b'), ['app_a', 'app_b'])
        self.assertEqual(self.install('b_ai'), ['app_b', 'liwan_ai'])

    def test_the_foundation_top_installs_alone_and_tests_every_foundation_module(self):
        self.assertEqual(self.install('liwan_api'), ['liwan_api'])
        self.assertEqual(app_isolation.test_tags('liwan_api', self.layers, self.addons),
                         '/liwan_core,/liwan_platform,/liwan_api')
        self.assertEqual(app_isolation.test_tags('app_a', self.layers, self.addons), '/app_a')
        self.assertEqual(app_isolation.test_tags('a_b', self.layers, self.addons), '/a_b')

    def test_the_foundation_alone_admits_no_application(self):
        self.check('liwan_api', ['liwan_core', 'liwan_platform', 'liwan_api'])
        for extra in ('app_a', 'liwan_directory'):
            with self.subTest(extra=extra), self.assertRaisesRegex(app_isolation.IsolationError, extra):
                self.check('liwan_api', ['liwan_core', 'liwan_platform', 'liwan_api', extra])

    def test_other_ranks_are_refused(self):
        for module in ('liwan_platform', 'liwan_ai', 'unknown'):
            with self.subTest(module=module), self.assertRaises(app_isolation.IsolationError):
                self.install(module)

    def test_a_bridge_without_exactly_two_sides_is_refused(self):
        (self.addons / 'a_b' / '__manifest__.py').write_text(repr({'depends': ['app_a', 'app_b', 'app_c']}))
        with self.assertRaises(app_isolation.IsolationError):
            self.install('a_b')


class AffectedTest(Fixture):
    MODULES = list(DEPENDS) + ['liwan_core', 'liwan_platform', 'liwan_directory', 'liwan_ai']

    def affected(self, *changed):
        return app_isolation.affected(set(changed), [m for m in self.MODULES if m in DEPENDS], self.addons)

    def test_a_change_reaches_its_dependents_transitively(self):
        self.assertEqual(self.affected('liwan_api'), ['a_b', 'api_c', 'app_a', 'app_b', 'app_c', 'b_ai', 'liwan_api'])
        self.assertEqual(self.affected('app_a'), ['a_b', 'app_a'])

    def test_a_leaf_change_reaches_only_itself(self):
        self.assertEqual(self.affected('a_b'), ['a_b'])

    def test_a_changed_name_outside_the_modules_is_dropped_but_still_reaches_dependents(self):
        self.assertEqual(self.affected('project'), ['a_b', 'app_a'])
        self.assertEqual(self.affected('not_released'), [])

    def test_the_matrix_keeps_only_the_affected_modules(self):
        self.assertEqual(app_isolation.matrix('apps', self.layers, self.addons, only=['app_b', 'a_b']), ['app_b'])
        self.assertEqual(app_isolation.matrix('bridges', self.layers, self.addons, only=['app_b', 'a_b']), ['a_b'])

    def test_an_unaffected_kind_has_no_group(self):
        self.assertEqual(app_isolation.matrix('apps', self.layers, self.addons, only=['a_b']), [])

    def test_the_foundation_top_joins_the_apps_matrix_only_when_affected(self):
        groups = app_isolation.matrix('apps', self.layers, self.addons, only=['liwan_api', 'app_c'])
        self.assertEqual(sorted(' '.join(groups).split()), ['app_c', 'liwan_api'])

    def test_no_filter_keeps_every_module(self):
        groups = app_isolation.matrix('bridges', self.layers, self.addons)
        self.assertEqual(sorted(' '.join(groups).split()), ['a_b', 'api_c', 'b_ai'])


class CheckTest(Fixture):
    def test_an_application_with_its_foundation_and_engines_is_isolated(self):
        self.check('app_b', ['liwan_core', 'liwan_api', 'liwan_directory', 'app_b'])

    def test_another_application_or_a_bridge_breaks_isolation(self):
        for extra in ('app_c', 'a_b'):
            with self.subTest(extra=extra), self.assertRaisesRegex(app_isolation.IsolationError, extra):
                self.check('app_a', ['liwan_core', 'app_a', extra])

    def test_a_bridge_between_the_foundation_and_the_application_belongs_to_its_run(self):
        # The foundation is in every run, so its bridge with app_c comes with app_c alone and nowhere else.
        self.check('app_c', ['liwan_core', 'liwan_api', 'app_c', 'api_c'])
        for module, installed in (('app_a', ['liwan_core', 'liwan_api', 'app_a', 'api_c']),
                                  ('liwan_api', ['liwan_core', 'liwan_platform', 'liwan_api', 'api_c'])):
            with self.subTest(module=module), self.assertRaisesRegex(app_isolation.IsolationError, 'api_c'):
                self.check(module, installed)

    def test_the_target_must_be_installed(self):
        with self.assertRaisesRegex(app_isolation.IsolationError, 'did not install app_a'):
            self.check('app_a', ['liwan_core'])

    def test_a_bridge_run_requires_the_bridge_and_both_sides(self):
        self.check('a_b', ['app_a', 'app_b', 'a_b'])
        with self.assertRaisesRegex(app_isolation.IsolationError, 'did not install a_b'):
            self.check('a_b', ['app_a', 'app_b'])

    def test_a_bridge_run_refuses_a_third_application(self):
        with self.assertRaisesRegex(app_isolation.IsolationError, 'app_c'):
            self.check('a_b', ['app_a', 'app_b', 'a_b', 'app_c'])


class RepositoryTest(unittest.TestCase):
    def output(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(app_isolation.main(list(argv)), 0)
        return out.getvalue().strip()

    def test_the_matrices_pack_the_rank_four_and_rank_five_modules_into_few_jobs(self):
        ranks = app_isolation.ranks()
        expected = {'apps': ['liwan_api', *sorted(m for m, r in ranks.items() if r == 4)],
                    'bridges': sorted(m for m, r in ranks.items() if r == 5)}
        for kind, modules in expected.items():
            with self.subTest(kind=kind):
                groups = json.loads(self.output('matrix', kind))
                self.assertLessEqual(len(groups), app_isolation.GROUP_COUNT[kind])
                packed = [module for group in groups for module in group.split()]
                self.assertEqual(sorted(packed), sorted(modules))

    def test_modules_narrow_the_matrix_and_a_bad_list_is_refused(self):
        self.assertEqual(json.loads(self.output('matrix', 'apps', '--modules', 'liwan_hr,liwan_access_hr')), ['liwan_hr'])
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app_isolation.main(['matrix', 'apps', '--modules', '']), 1)

    def test_every_registered_bridge_links_exactly_two_liwan_modules(self):
        for bridge in app_isolation.modules_of_rank(app_isolation.BRIDGE_RANK):
            with self.subTest(bridge=bridge):
                self.assertEqual(len(self.output('install', bridge).split(',')), 2)

    def test_the_foundation_top_is_liwan_api(self):
        self.assertEqual(self.output('foundation'), 'liwan_api')

    def test_rank_prints_the_layer_rank(self):
        self.assertEqual(self.output('rank', 'liwan_ai'), '3')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app_isolation.main(['rank', 'unknown_module']), 1)

    def test_a_failed_check_exits_nonzero(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app_isolation.main(['check', 'liwan_hr', '--installed', 'liwan_core']), 1)


if __name__ == '__main__':
    unittest.main()
