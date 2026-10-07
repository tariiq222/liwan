# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of the managed tiers, read from the REAL addon manifests."""
import sys
import tempfile
import unittest
from pathlib import Path

from nasq_cli import module_closure, operator

ADDONS = Path(__file__).resolve().parents[1] / 'odoo-addons'
BASE = ['nasq_core', 'nasq_platform', 'nasq_api']
# Hand-computed from the manifests' `depends`; literals on purpose.
EXPECTED = {
    'projects': (BASE + ['nasq_pmo', 'nasq_meetings'],
                 {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory', 'nasq_pmo',
                  'nasq_meetings', 'nasq_meetings_pmo'}),
    'people': (BASE + ['nasq_hr'], {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_hr'}),
    'messaging': (BASE + ['nasq_chat'], {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_chat'}),
    'core': (BASE, {'nasq_core', 'nasq_platform', 'nasq_api'}),
}


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
            operator._validate_module_closure(entry, BASE + ['nasq_no_such_module'])

    def test_missing_dependency_manifest_is_an_error(self):
        with tempfile.TemporaryDirectory() as root:
            module = Path(root) / 'nasq_lonely'
            module.mkdir()
            (module / '__manifest__.py').write_text("{'depends': ['nasq_ghost']}")
            with self.assertRaises(module_closure.ClosureError):
                module_closure.install_closure([root], ['nasq_lonely'])
            with self.assertRaises(operator.OperatorFailure):
                operator._validate_module_closure({'addons_paths': [root]}, ['nasq_lonely'])

    def test_auto_install_module_joins_when_dependencies_are_inside(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'nasq_a': "{'depends': ['base']}",
                'nasq_glue': "{'depends': ['nasq_a'], 'auto_install': True}",
                'nasq_other': "{'depends': ['nasq_a', 'nasq_b'], 'auto_install': True}",
                'nasq_b': "{'depends': ['base']}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(module_closure.install_closure([root], ['nasq_a']), {'nasq_a', 'nasq_glue'})

    def test_auto_install_module_needs_its_odoo_dependencies_in_the_closure(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'nasq_a': "{'depends': ['project']}",
                'nasq_b': "{'depends': ['hr']}",
                'nasq_glue_project': "{'depends': ['nasq_a', 'project'], 'auto_install': True}",
                'nasq_glue_mail': "{'depends': ['nasq_a', 'mail'], 'auto_install': True}",
                'nasq_glue_base': "{'depends': ['base'], 'auto_install': True}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(
                module_closure.install_closure([root], ['nasq_a']),
                {'nasq_a', 'nasq_glue_project', 'nasq_glue_base'},
            )
            self.assertEqual(module_closure.install_closure([root], ['nasq_b']), {'nasq_b', 'nasq_glue_base'})

    def test_the_real_meetings_bridge_joins_only_with_both_applications(self):
        shared = {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory'}
        self.assertEqual(
            module_closure.install_closure([ADDONS], BASE + ['nasq_meetings']), shared | {'nasq_meetings'},
        )
        self.assertEqual(module_closure.install_closure([ADDONS], BASE + ['nasq_pmo']), shared | {'nasq_pmo'})
        self.assertIn(
            'nasq_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['nasq_meetings', 'nasq_pmo']),
        )

    def test_projects_tier_closure_from_real_manifests_includes_the_bridge(self):
        projects = module_closure.install_closure([ADDONS], BASE + ['nasq_pmo', 'nasq_meetings'])
        self.assertIn('nasq_meetings_pmo', projects)
        for tier_name in ('people', 'messaging', 'core'):
            with self.subTest(tier=tier_name):
                self.assertNotIn(
                    'nasq_meetings_pmo', module_closure.install_closure([ADDONS], EXPECTED[tier_name][0]),
                )
        # Meetings without nasq_pmo: bridge stays out.
        self.assertNotIn('nasq_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['nasq_meetings']))


if __name__ == '__main__':
    sys.exit(unittest.main())
