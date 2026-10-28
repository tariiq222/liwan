# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of the managed tiers, read from the REAL addon manifests."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import catalog_check
from webvue_cli import module_closure, operator

ADDONS = Path(__file__).resolve().parents[1] / 'odoo-addons'
BASE = ['webvue_core', 'webvue_platform', 'webvue_api']


def _release_tiers():
    """Tier id -> (selected modules, closure), derived from the committed release solution."""
    name, _modules = catalog_check.current_release(ADDONS.parent)
    data = json.loads((ADDONS.parent / 'deploy/catalog/solutions' / name).read_text())
    return {
        tier['id']: (data['base_modules'] + tier['modules'],
                     module_closure.install_closure([ADDONS], data['base_modules'] + tier['modules']))
        for tier in data['tiers']
    }


# Hand-computed pin for the three base modules; applications are derived from the release.
EXPECTED = {'core': (BASE, {'webvue_core', 'webvue_platform', 'webvue_api'}), **_release_tiers()}


class RealManifestClosureTest(unittest.TestCase):
    def test_each_tier_closure_is_exact(self):
        for tier, (selected, expected) in EXPECTED.items():
            with self.subTest(tier=tier):
                self.assertEqual(module_closure.install_closure([ADDONS], selected), expected)

    def test_operator_accepts_tiers_with_implied_dependencies(self):
        entry = {'addons_paths': [str(ADDONS)]}
        for tier, (selected, _expected) in EXPECTED.items():
            with self.subTest(tier=tier):
                operator._validate_module_closure(entry, selected)

    def test_operator_still_rejects_a_missing_module(self):
        entry = {'addons_paths': [str(ADDONS)]}
        with self.assertRaises(operator.OperatorFailure):
            operator._validate_module_closure(entry, BASE + ['webvue_no_such_module'])

    def test_missing_dependency_manifest_is_an_error(self):
        with tempfile.TemporaryDirectory() as root:
            module = Path(root) / 'webvue_lonely'
            module.mkdir()
            (module / '__manifest__.py').write_text("{'depends': ['webvue_ghost']}")
            with self.assertRaises(module_closure.ClosureError):
                module_closure.install_closure([root], ['webvue_lonely'])
            with self.assertRaises(operator.OperatorFailure):
                operator._validate_module_closure({'addons_paths': [root]}, ['webvue_lonely'])

    def test_auto_install_module_joins_when_dependencies_are_inside(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'webvue_a': "{'depends': ['base']}",
                'webvue_glue': "{'depends': ['webvue_a'], 'auto_install': True}",
                'webvue_other': "{'depends': ['webvue_a', 'webvue_b'], 'auto_install': True}",
                'webvue_b': "{'depends': ['base']}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(module_closure.install_closure([root], ['webvue_a']), {'webvue_a', 'webvue_glue'})

    def test_auto_install_module_needs_its_odoo_dependencies_in_the_closure(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'webvue_a': "{'depends': ['project']}",
                'webvue_b': "{'depends': ['hr']}",
                'webvue_glue_project': "{'depends': ['webvue_a', 'project'], 'auto_install': True}",
                'webvue_glue_mail': "{'depends': ['webvue_a', 'mail'], 'auto_install': True}",
                'webvue_glue_base': "{'depends': ['base'], 'auto_install': True}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(
                module_closure.install_closure([root], ['webvue_a']),
                {'webvue_a', 'webvue_glue_project', 'webvue_glue_base'},
            )
            self.assertEqual(module_closure.install_closure([root], ['webvue_b']), {'webvue_b', 'webvue_glue_base'})

    def test_a_listed_auto_install_joins_on_its_triggers_and_brings_its_other_dependencies(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'webvue_a': "{'depends': ['project']}",
                'webvue_b': "{'depends': ['base']}",
                'webvue_c': "{'depends': ['hr']}",
                'webvue_glue': "{'depends': ['webvue_a', 'webvue_b', 'webvue_c', 'sale_x'], 'auto_install': ['webvue_a', 'webvue_b']}",
                'webvue_after': "{'depends': ['webvue_c', 'sale_x'], 'auto_install': True}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(
                module_closure.install_closure([root], ['webvue_a', 'webvue_b']),
                {'webvue_a', 'webvue_b', 'webvue_c', 'webvue_glue', 'webvue_after'},
            )
            self.assertEqual(module_closure.install_closure([root], ['webvue_a']), {'webvue_a'})
            (Path(root) / 'webvue_always').mkdir()
            (Path(root) / 'webvue_always' / '__manifest__.py').write_text("{'depends': ['webvue_b'], 'auto_install': []}")
            (Path(root) / 'webvue_tuple').mkdir()
            (Path(root) / 'webvue_tuple' / '__manifest__.py').write_text("{'depends': ['webvue_a', 'webvue_c'], 'auto_install': ('webvue_a',)}")
            # An empty trigger list installs the module with any selection, as Odoo does (here it brings webvue_b,
            # which completes the triggers of webvue_glue); a tuple is a trigger list.
            self.assertEqual(
                module_closure.install_closure([root], ['webvue_a']),
                {'webvue_a', 'webvue_always', 'webvue_b', 'webvue_glue', 'webvue_tuple', 'webvue_c', 'webvue_after'},
            )
            (Path(root) / 'webvue_bad').mkdir()
            (Path(root) / 'webvue_bad' / '__manifest__.py').write_text("{'depends': ['webvue_a'], 'auto_install': ['webvue_b']}")
            with self.assertRaises(module_closure.ClosureError):
                module_closure.install_closure([root], ['webvue_bad'])

    def test_the_real_payments_bridge_joins_only_with_appointments_and_payments(self):
        both = module_closure.install_closure([ADDONS], BASE + ['webvue_appointments', 'webvue_payments'])
        self.assertIn('webvue_appointments_payments', both)
        for alone in ('webvue_appointments', 'webvue_payments'):
            with self.subTest(alone=alone):
                self.assertNotIn('webvue_appointments_payments', module_closure.install_closure([ADDONS], BASE + [alone]))

    def test_the_real_meetings_bridge_joins_only_with_both_applications(self):
        shared = {'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory'}
        self.assertEqual(
            module_closure.install_closure([ADDONS], BASE + ['webvue_meetings']), shared | {'webvue_meetings'},
        )
        self.assertEqual(module_closure.install_closure([ADDONS], BASE + ['webvue_pmo']), shared | {'webvue_pmo'})
        self.assertIn(
            'webvue_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['webvue_meetings', 'webvue_pmo']),
        )

    def test_projects_tier_closure_from_real_manifests_includes_the_bridge(self):
        projects = module_closure.install_closure([ADDONS], BASE + ['webvue_pmo', 'webvue_meetings'])
        self.assertIn('webvue_meetings_pmo', projects)
        for tier_name in ('people', 'messaging', 'core'):
            with self.subTest(tier=tier_name):
                self.assertNotIn(
                    'webvue_meetings_pmo', module_closure.install_closure([ADDONS], EXPECTED[tier_name][0]),
                )
        # Meetings without webvue_pmo: bridge stays out.
        self.assertNotIn('webvue_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['webvue_meetings']))


if __name__ == '__main__':
    sys.exit(unittest.main())
