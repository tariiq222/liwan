# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of the managed tiers, read from the REAL addon manifests."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import catalog_check
from liwan_cli import module_closure, operator

ADDONS = Path(__file__).resolve().parents[1] / 'odoo-addons'
BASE = ['liwan_core', 'liwan_platform', 'liwan_api']


def _manifest_depends(manifest: Path):
    """The `depends` list of one addon manifest, parsed as Python (the manifests are literals)."""
    import ast
    return ast.literal_eval(manifest.read_text()).get('depends') or []


def _manifest_auto_install(manifest: Path):
    """The `auto_install` value: absent is None, a plain `True` is True, a trigger list is truthy as well."""
    import ast
    return ast.literal_eval(manifest.read_text()).get('auto_install')


def _release_tiers():
    """Tier id -> (selected modules, closure), derived from the committed release solution."""
    name, _modules = catalog_check.current_release(ADDONS.parent)
    data = json.loads((ADDONS.parent / 'deploy/catalog/solutions' / name).read_text())
    return {
        tier['id']: (data['base_modules'] + tier['modules'],
                     module_closure.install_closure([ADDONS], data['base_modules'] + tier['modules']))
        for tier in data['tiers']
    }


# The three base modules; every other tier's closure is derived from the release, not pinned.
BASE_TIER = (BASE, {'liwan_core', 'liwan_platform', 'liwan_api'})


class RealManifestClosureTest(unittest.TestCase):
    def test_tier_closures_match_the_closures_read_by_hand_from_the_manifests(self):
        # Expected values written out from the manifests, not computed: liwan_hr depends on liwan_api and liwan_notify, and
        # the auto_install bridge liwan_access_hr joins once liwan_api and liwan_hr are in; liwan_appointments depends on
        # liwan_api alone (plus Odoo's resource_booking) and has no bridge with the base modules.
        expected = {
            'people': {'liwan_core', 'liwan_platform', 'liwan_api', 'liwan_notify', 'liwan_hr', 'liwan_access_hr'},
            'appointments': {'liwan_core', 'liwan_platform', 'liwan_api', 'liwan_appointments'},
        }
        tiers = _release_tiers()
        for tier, modules in expected.items():
            with self.subTest(tier=tier):
                self.assertEqual(module_closure.install_closure([ADDONS], tiers[tier][0]), modules)

    def test_each_tier_closure_is_closed_under_its_own_auto_install_rules(self):
        # Independent property: feeding a tier's own closure back in must not grow it. If it did, the tier was not a
        # fixed point and the install would pull in a module its declaration never reaches.
        for tier, (selected, _expected) in _release_tiers().items():
            with self.subTest(tier=tier):
                closure = module_closure.install_closure([ADDONS], selected)
                self.assertEqual(module_closure.install_closure([ADDONS], sorted(closure)), closure)

    def test_no_always_open_core_addon_depends_on_a_locked_tier_addon(self):
        """The property the release relies on: a core installation never drags a paid tier in.

        The core tier is always installed. If any addon reachable from the base + core selection declared a dependency on
        an addon that only a non-core tier *selects*, every customer would silently receive that tier. This inspects the
        manifests directly rather than comparing closures, because a closure comparison hides the very violation it is
        looking for: the offending dependency would simply pull the locked module into the core closure.
        """
        tiers = _release_tiers()
        core_selection = set(tiers['core'][0])
        # What the paid tiers select, minus anything the core already installs: a module both tiers select is core's.
        locked = set()
        for tier_id, (selected, _closure) in tiers.items():
            if tier_id != 'core':
                locked |= set(selected)
        locked -= core_selection
        self.assertTrue(locked, 'no locked tier modules found: the test would prove nothing')
        core_closure = module_closure.install_closure([ADDONS], sorted(core_selection))
        offenders = []
        for module in sorted(core_closure):
            manifest = ADDONS / module / '__manifest__.py'
            if not manifest.is_file():
                continue
            reached = set(_manifest_depends(manifest)) & locked
            if reached:
                offenders.append((module, sorted(reached)))
        self.assertEqual(offenders, [])

    def test_each_pmo_hr_ai_bridge_requires_both_of_its_features(self):
        """A bridge addon (`<app>_pmo`, `<app>_hr`, `<app>_ai`) must depend on the capability AND on its base app."""
        capability = {'_pmo': 'liwan_pmo', '_hr': 'liwan_hr', '_ai': 'liwan_ai'}
        # The capability addons themselves end in the same suffix; a bridge is a *different* addon that joins them.
        bridges = [path for path in sorted(ADDONS.iterdir())
                   if path.is_dir() and not any(path.name == name for name in capability.values())
                   and any(path.name.endswith(suffix) for suffix in capability)]
        self.assertTrue(bridges, 'no bridge addons found: the test would prove nothing')
        for path in bridges:
            suffix = next(s for s in capability if path.name.endswith(s))
            with self.subTest(bridge=path.name):
                depends = _manifest_depends(path / '__manifest__.py')
                self.assertIn(capability[suffix], depends, f'{path.name} must depend on {capability[suffix]}')
                # The other half: the application the bridge attaches the capability to.
                self.assertTrue([d for d in depends if d.startswith('liwan_') and d != capability[suffix]],
                                f'{path.name} must also depend on the application it bridges')
                self.assertIsNot(_manifest_auto_install(path / '__manifest__.py'), False,
                                 f'{path.name} is a bridge and must be auto_install')

    def test_operator_accepts_tiers_with_implied_dependencies(self):
        entry = {'addons_paths': [str(ADDONS)]}
        for tier, (selected, _expected) in {**{'core': BASE_TIER}, **_release_tiers()}.items():
            with self.subTest(tier=tier):
                operator._validate_module_closure(entry, selected)

    def test_operator_still_rejects_a_missing_module(self):
        entry = {'addons_paths': [str(ADDONS)]}
        with self.assertRaises(operator.OperatorFailure):
            operator._validate_module_closure(entry, BASE + ['liwan_no_such_module'])

    def test_missing_dependency_manifest_is_an_error(self):
        with tempfile.TemporaryDirectory() as root:
            module = Path(root) / 'liwan_lonely'
            module.mkdir()
            (module / '__manifest__.py').write_text("{'depends': ['liwan_ghost']}")
            with self.assertRaises(module_closure.ClosureError):
                module_closure.install_closure([root], ['liwan_lonely'])
            with self.assertRaises(operator.OperatorFailure):
                operator._validate_module_closure({'addons_paths': [root]}, ['liwan_lonely'])

    def test_auto_install_module_joins_when_dependencies_are_inside(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'liwan_a': "{'depends': ['base']}",
                'liwan_glue': "{'depends': ['liwan_a'], 'auto_install': True}",
                'liwan_other': "{'depends': ['liwan_a', 'liwan_b'], 'auto_install': True}",
                'liwan_b': "{'depends': ['base']}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(module_closure.install_closure([root], ['liwan_a']), {'liwan_a', 'liwan_glue'})

    def test_auto_install_module_needs_its_odoo_dependencies_in_the_closure(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'liwan_a': "{'depends': ['project']}",
                'liwan_b': "{'depends': ['hr']}",
                'liwan_glue_project': "{'depends': ['liwan_a', 'project'], 'auto_install': True}",
                'liwan_glue_mail': "{'depends': ['liwan_a', 'mail'], 'auto_install': True}",
                'liwan_glue_base': "{'depends': ['base'], 'auto_install': True}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(
                module_closure.install_closure([root], ['liwan_a']),
                {'liwan_a', 'liwan_glue_project', 'liwan_glue_base'},
            )
            self.assertEqual(module_closure.install_closure([root], ['liwan_b']), {'liwan_b', 'liwan_glue_base'})

    def test_a_listed_auto_install_joins_on_its_triggers_and_brings_its_other_dependencies(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'liwan_a': "{'depends': ['project']}",
                'liwan_b': "{'depends': ['base']}",
                'liwan_c': "{'depends': ['hr']}",
                'liwan_glue': "{'depends': ['liwan_a', 'liwan_b', 'liwan_c', 'sale_x'], 'auto_install': ['liwan_a', 'liwan_b']}",
                'liwan_after': "{'depends': ['liwan_c', 'sale_x'], 'auto_install': True}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(
                module_closure.install_closure([root], ['liwan_a', 'liwan_b']),
                {'liwan_a', 'liwan_b', 'liwan_c', 'liwan_glue', 'liwan_after'},
            )
            self.assertEqual(module_closure.install_closure([root], ['liwan_a']), {'liwan_a'})
            (Path(root) / 'liwan_always').mkdir()
            (Path(root) / 'liwan_always' / '__manifest__.py').write_text("{'depends': ['liwan_b'], 'auto_install': []}")
            (Path(root) / 'liwan_tuple').mkdir()
            (Path(root) / 'liwan_tuple' / '__manifest__.py').write_text("{'depends': ['liwan_a', 'liwan_c'], 'auto_install': ('liwan_a',)}")
            # An empty trigger list installs the module with any selection, as Odoo does (here it brings liwan_b,
            # which completes the triggers of liwan_glue); a tuple is a trigger list.
            self.assertEqual(
                module_closure.install_closure([root], ['liwan_a']),
                {'liwan_a', 'liwan_always', 'liwan_b', 'liwan_glue', 'liwan_tuple', 'liwan_c', 'liwan_after'},
            )
            (Path(root) / 'liwan_bad').mkdir()
            (Path(root) / 'liwan_bad' / '__manifest__.py').write_text("{'depends': ['liwan_a'], 'auto_install': ['liwan_b']}")
            with self.assertRaises(module_closure.ClosureError):
                module_closure.install_closure([root], ['liwan_bad'])

    def test_the_real_payments_bridge_joins_only_with_appointments_and_payments(self):
        both = module_closure.install_closure([ADDONS], BASE + ['liwan_appointments', 'liwan_payments'])
        self.assertIn('liwan_appointments_payments', both)
        for alone in ('liwan_appointments', 'liwan_payments'):
            with self.subTest(alone=alone):
                self.assertNotIn('liwan_appointments_payments', module_closure.install_closure([ADDONS], BASE + [alone]))

    def test_the_real_inbox_payments_bridge_joins_only_with_inbox_and_payments(self):
        both = module_closure.install_closure([ADDONS], BASE + ['liwan_inbox', 'liwan_payments'])
        self.assertIn('liwan_inbox_payments', both)
        for alone in ('liwan_inbox', 'liwan_payments'):
            with self.subTest(alone=alone):
                self.assertNotIn('liwan_inbox_payments', module_closure.install_closure([ADDONS], BASE + [alone]))

    def test_the_real_meetings_bridge_joins_only_with_both_applications(self):
        shared = {'liwan_core', 'liwan_platform', 'liwan_api', 'liwan_notify', 'liwan_directory'}
        self.assertEqual(
            module_closure.install_closure([ADDONS], BASE + ['liwan_meetings']), shared | {'liwan_meetings'},
        )
        self.assertEqual(module_closure.install_closure([ADDONS], BASE + ['liwan_pmo']), shared | {'liwan_pmo'})
        self.assertIn(
            'liwan_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['liwan_meetings', 'liwan_pmo']),
        )

    def test_projects_tier_closure_from_real_manifests_includes_the_bridge(self):
        projects = module_closure.install_closure([ADDONS], BASE + ['liwan_pmo', 'liwan_meetings'])
        self.assertIn('liwan_meetings_pmo', projects)
        # Every tier of the current release that does not install liwan_pmo itself keeps the bridge out.
        tiers = _release_tiers()
        for tier_name in ('people', 'finance', 'appointments', 'crm', 'inbox', 'core'):
            with self.subTest(tier=tier_name):
                selection = BASE if tier_name == 'core' else tiers[tier_name][0]
                self.assertNotIn('liwan_meetings_pmo', module_closure.install_closure([ADDONS], selection))
        # Meetings without liwan_pmo: bridge stays out.
        self.assertNotIn('liwan_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['liwan_meetings']))


if __name__ == '__main__':
    sys.exit(unittest.main())
