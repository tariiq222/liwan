"""The application and bridge isolation runs: what they install and what they must not."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import app_isolation

RANKS = {'webvue_core': 0, 'webvue_platform': 1, 'webvue_api': 2, 'webvue_directory': 3, 'webvue_ai': 3,
         'app_a': 4, 'app_b': 4, 'app_c': 4, 'a_b': 5, 'b_ai': 5}
DEPENDS = {'webvue_api': ['webvue_platform'], 'app_a': ['webvue_api', 'project'], 'app_b': ['webvue_api', 'webvue_directory'], 'app_c': ['webvue_api'],
           'a_b': ['app_a', 'app_b'], 'b_ai': ['app_b', 'webvue_ai', 'mail']}


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

    def test_a_bridge_installs_its_two_webvue_sides(self):
        self.assertEqual(self.install('a_b'), ['app_a', 'app_b'])
        self.assertEqual(self.install('b_ai'), ['app_b', 'webvue_ai'])

    def test_the_foundation_top_installs_alone_and_tests_every_foundation_module(self):
        self.assertEqual(self.install('webvue_api'), ['webvue_api'])
        self.assertEqual(app_isolation.test_tags('webvue_api', self.layers, self.addons),
                         '/webvue_core,/webvue_platform,/webvue_api')
        self.assertEqual(app_isolation.test_tags('app_a', self.layers, self.addons), '/app_a')
        self.assertEqual(app_isolation.test_tags('a_b', self.layers, self.addons), '/a_b')

    def test_the_foundation_alone_admits_no_application(self):
        self.check('webvue_api', ['webvue_core', 'webvue_platform', 'webvue_api'])
        for extra in ('app_a', 'webvue_directory'):
            with self.subTest(extra=extra), self.assertRaisesRegex(app_isolation.IsolationError, extra):
                self.check('webvue_api', ['webvue_core', 'webvue_platform', 'webvue_api', extra])

    def test_other_ranks_are_refused(self):
        for module in ('webvue_platform', 'webvue_ai', 'unknown'):
            with self.subTest(module=module), self.assertRaises(app_isolation.IsolationError):
                self.install(module)

    def test_a_bridge_without_exactly_two_sides_is_refused(self):
        (self.addons / 'a_b' / '__manifest__.py').write_text(repr({'depends': ['app_a', 'app_b', 'app_c']}))
        with self.assertRaises(app_isolation.IsolationError):
            self.install('a_b')


class CheckTest(Fixture):
    def test_an_application_with_its_foundation_and_engines_is_isolated(self):
        self.check('app_b', ['webvue_core', 'webvue_api', 'webvue_directory', 'app_b'])

    def test_another_application_or_a_bridge_breaks_isolation(self):
        for extra in ('app_c', 'a_b'):
            with self.subTest(extra=extra), self.assertRaisesRegex(app_isolation.IsolationError, extra):
                self.check('app_a', ['webvue_core', 'app_a', extra])

    def test_the_target_must_be_installed(self):
        with self.assertRaisesRegex(app_isolation.IsolationError, 'did not install app_a'):
            self.check('app_a', ['webvue_core'])

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

    def test_the_matrices_are_the_rank_four_and_rank_five_modules(self):
        ranks = app_isolation.ranks()
        self.assertEqual(json.loads(self.output('matrix', 'apps')),
                         ['webvue_api', *sorted(m for m, r in ranks.items() if r == 4)])
        self.assertEqual(json.loads(self.output('matrix', 'bridges')), sorted(m for m, r in ranks.items() if r == 5))

    def test_every_registered_bridge_links_exactly_two_webvue_modules(self):
        for bridge in app_isolation.modules_of_rank(app_isolation.BRIDGE_RANK):
            with self.subTest(bridge=bridge):
                self.assertEqual(len(self.output('install', bridge).split(',')), 2)

    def test_the_foundation_top_is_webvue_api(self):
        self.assertEqual(self.output('foundation'), 'webvue_api')

    def test_rank_prints_the_layer_rank(self):
        self.assertEqual(self.output('rank', 'webvue_ai'), '3')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app_isolation.main(['rank', 'unknown_module']), 1)

    def test_a_failed_check_exits_nonzero(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(app_isolation.main(['check', 'webvue_hr', '--installed', 'webvue_core']), 1)


if __name__ == '__main__':
    unittest.main()
