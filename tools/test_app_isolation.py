"""The application and bridge isolation runs: what they install and what they must not."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import app_isolation

RANKS = {'liwan_core': 0, 'liwan_platform': 1, 'liwan_api': 2, 'liwan_directory': 3, 'liwan_ai': 3,
         'app_a': 4, 'app_b': 4, 'app_c': 4, 'a_b': 5, 'b_ai': 5, 'api_c': 5, 'dir_ai': 5, 'api_stock': 5,
         'a_b_sale': 5, 'b_stock': 5}
DEPENDS = {'liwan_api': ['liwan_platform'], 'app_a': ['liwan_api', 'project'], 'app_b': ['liwan_api', 'liwan_directory'], 'app_c': ['liwan_api'],
           'a_b': ['app_a', 'app_b'], 'b_ai': ['app_b', 'liwan_ai', 'mail'], 'api_c': ['liwan_api', 'app_c'],
           'dir_ai': ['liwan_directory', 'liwan_ai'], 'api_stock': ['liwan_api', 'account'],
           'a_b_sale': ['app_a', 'app_b', 'sale'], 'b_stock': ['app_b', 'project']}
# A one-LiwanOS-side bridge names its stock side in `auto_install`; the two-LiwanOS-side one names both sides.
AUTO_INSTALL = {'api_stock': ['liwan_api', 'account'], 'a_b_sale': ['app_a', 'app_b'],
                'b_stock': ['app_b', 'project']}


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
            manifest = {'name': module, 'depends': depends}
            if module in AUTO_INSTALL:
                manifest['auto_install'] = AUTO_INSTALL[module]
            (self.addons / module / '__manifest__.py').write_text(repr(manifest))

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

    def test_a_bridge_installs_one_liwan_side_and_its_stock_side(self):
        self.assertEqual(self.install('api_stock'), ['account', 'liwan_api'])
        self.assertEqual(app_isolation.test_tags('api_stock', self.layers, self.addons), '/api_stock')

    def test_a_two_liwan_side_bridge_that_also_needs_stock_is_unchanged(self):
        self.assertEqual(self.install('a_b_sale'), ['app_a', 'app_b'])
        self.assertEqual(self.install('a_b'), ['app_a', 'app_b'])
        self.assertEqual(self.install('b_ai'), ['app_b', 'liwan_ai'])
        self.check('a_b_sale', ['app_a', 'app_b', 'a_b_sale'])
        with self.assertRaisesRegex(app_isolation.IsolationError, 'app_c'):
            self.check('a_b_sale', ['app_a', 'app_b', 'a_b_sale', 'app_c'])

    def test_a_one_liwan_side_bridge_may_also_depend_on_other_stock_modules(self):
        # Like liwan_inbox_payments depending on stock sale: the stock SIDE is the one auto_install names, and any
        # other stock module is a plain dependency that Odoo installs with it.
        (self.addons / 'api_stock' / '__manifest__.py').write_text(
            repr({'depends': ['liwan_api', 'account', 'sale'], 'auto_install': ['liwan_api', 'account']}))
        self.assertEqual(self.install('api_stock'), ['account', 'liwan_api'])

    def test_a_malformed_bridge_is_refused_naming_what_was_found(self):
        cases = {
            'a_b': ({'depends': ['app_a', 'app_b', 'app_c']}, 'LiwanOS modules app_a, app_b, app_c'),
            'api_stock': ({'depends': ['liwan_api']}, 'stock dependencies none'),
            'api_c': ({'depends': ['account', 'sale'], 'auto_install': ['account', 'sale']},
                      'LiwanOS modules none'),
        }
        for module, (manifest, found) in cases.items():
            with self.subTest(module=module), self.assertRaisesRegex(app_isolation.IsolationError, found):
                (self.addons / module / '__manifest__.py').write_text(repr(manifest))
                self.install(module)

    def test_a_one_liwan_side_bridge_must_auto_install_on_exactly_its_two_sides(self):
        for auto_install in (True, ['liwan_api'], ['liwan_api', 'account', 'sale'], ['liwan_api', 'project']):
            with self.subTest(auto_install=auto_install), \
                    self.assertRaisesRegex(app_isolation.IsolationError, 'auto_install'):
                (self.addons / 'api_stock' / '__manifest__.py').write_text(
                    repr({'depends': ['liwan_api', 'account'], 'auto_install': auto_install}))
                self.install('api_stock')

    def test_a_one_liwan_side_bridge_must_depend_on_the_stock_module_its_auto_install_names(self):
        (self.addons / 'api_stock' / '__manifest__.py').write_text(
            repr({'depends': ['liwan_api', 'sale'], 'auto_install': ['liwan_api', 'account']}))
        with self.assertRaisesRegex(app_isolation.IsolationError, 'stock dependencies sale'):
            self.install('api_stock')

    def test_a_one_liwan_side_bridge_that_auto_installs_on_two_stock_modules_is_refused(self):
        (self.addons / 'api_stock' / '__manifest__.py').write_text(
            repr({'depends': ['liwan_api', 'account', 'sale'], 'auto_install': ['liwan_api', 'account', 'sale']}))
        with self.assertRaisesRegex(app_isolation.IsolationError, 'stock dependencies account, sale'):
            self.install('api_stock')


class AffectedTest(Fixture):
    MODULES = list(DEPENDS) + ['liwan_core', 'liwan_platform', 'liwan_directory', 'liwan_ai']

    def affected(self, *changed):
        return app_isolation.affected(set(changed), [m for m in self.MODULES if m in DEPENDS], self.addons)

    def test_a_change_reaches_its_dependents_transitively(self):
        self.assertEqual(self.affected('liwan_api'),
                         ['a_b', 'a_b_sale', 'api_c', 'api_stock', 'app_a', 'app_b', 'app_c', 'b_ai', 'b_stock',
                          'liwan_api'])
        self.assertEqual(self.affected('app_a'), ['a_b', 'a_b_sale', 'app_a'])
        # A bridge with a stock side is affected through its LiwanOS side, which is the only side a change can name.
        self.assertEqual(self.affected('app_b'), ['a_b', 'a_b_sale', 'app_b', 'b_ai', 'b_stock'])

    def test_a_leaf_change_reaches_only_itself(self):
        self.assertEqual(self.affected('a_b'), ['a_b'])

    def test_a_changed_name_outside_the_modules_is_dropped_but_still_reaches_dependents(self):
        self.assertEqual(self.affected('project'), ['a_b', 'a_b_sale', 'app_a', 'b_stock'])
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
        self.assertEqual(sorted(' '.join(groups).split()),
                         ['a_b', 'a_b_sale', 'api_c', 'api_stock', 'b_ai', 'b_stock', 'dir_ai'])


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

    def test_a_bridge_between_two_shared_services_of_the_run_belongs_to_it(self):
        # app_b pulls liwan_directory in and b_ai adds liwan_ai: their bridge auto-installs with that run.
        self.check('b_ai', ['liwan_core', 'liwan_directory', 'liwan_ai', 'app_b', 'b_ai', 'dir_ai'])
        with self.assertRaisesRegex(app_isolation.IsolationError, 'dir_ai'):
            self.check('app_a', ['liwan_core', 'liwan_directory', 'app_a', 'dir_ai'])

    def test_a_bridge_run_requires_the_bridge_and_both_sides(self):
        self.check('a_b', ['app_a', 'app_b', 'a_b'])
        with self.assertRaisesRegex(app_isolation.IsolationError, 'did not install a_b'):
            self.check('a_b', ['app_a', 'app_b'])

    def test_a_one_liwan_side_bridge_run_requires_the_bridge_and_its_liwan_side(self):
        # The stock side is an Odoo dependency of the run, never a LiwanOS module of the installed list.
        self.check('api_stock', ['liwan_core', 'liwan_platform', 'liwan_api', 'api_stock'])
        with self.assertRaisesRegex(app_isolation.IsolationError, 'did not install api_stock'):
            self.check('api_stock', ['liwan_core', 'liwan_platform', 'liwan_api'])

    def test_a_one_liwan_side_bridge_belongs_to_the_run_of_its_liwan_side(self):
        # It auto-installs with its LiwanOS side; its stock side is an Odoo dependency the installed LiwanOS list
        # cannot show. An application run that does not install its LiwanOS side refuses it like any other bridge.
        self.check('app_b', ['liwan_core', 'liwan_api', 'liwan_directory', 'app_b', 'b_stock'])
        with self.assertRaisesRegex(app_isolation.IsolationError, 'b_stock'):
            self.check('app_a', ['liwan_core', 'liwan_api', 'app_a', 'b_stock'])

    def test_a_foundation_bridge_with_a_stock_side_is_allowed_in_any_run_that_has_the_foundation(self):
        # Odoo installs it only together with its stock side, which the LiwanOS list cannot show, so its only
        # visible trigger is the foundation that every run has. A stock-account run (finance) gets it legitimately.
        self.check('app_a', ['liwan_core', 'liwan_api', 'app_a', 'api_stock'])

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

    def test_every_registered_bridge_links_two_sides(self):
        # A rank registered before its addon directory exists is a tools/arch_policy.py failure, not this tool's.
        bridges = [bridge for bridge in app_isolation.modules_of_rank(app_isolation.BRIDGE_RANK)
                   if (app_isolation.ADDONS / bridge / '__manifest__.py').is_file()]
        self.assertTrue(bridges, 'no registered bridge has a manifest: the test would prove nothing')
        for bridge in bridges:
            with self.subTest(bridge=bridge):
                self.assertEqual(len(app_isolation.sides(bridge)), 2)
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
