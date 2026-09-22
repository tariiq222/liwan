# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Catalog checks run offline against a synthetic repository root.

Every negative case builds the smallest repository that must fail, so a passing run
proves the rule fires instead of merely proving the committed catalog is accepted.
"""
import ast
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import catalog_check

ROOT = Path(__file__).resolve().parents[1]
REAL_CATALOG = ROOT / catalog_check.CATALOG_DIR

MANIFEST = """# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': %(name)r,
    'summary': %(summary)r,
    'version': '19.0.1.0.0',
    'license': 'LGPL-3',
    'depends': %(depends)r,
}
"""

REGISTRY = """# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class Demo(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
%(features)s
        )

    @api.model
    def _nasq_module_definitions(self):
        return super()._nasq_module_definitions() + (
            {'id': 'demo_pmo'},
        )
"""


def feature(key, kind, owner, module):
    return "            {'key': %r, 'type': %r, 'owner': %r, 'module': %r},\n" % (
        key, kind, owner, module,
    )


class CatalogCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        addons = self.root / 'odoo-addons'
        addons.mkdir()
        self.manifest(addons, 'demo_core', [], 'Demo core')
        self.manifest(addons, 'demo_pmo', ['demo_core'], 'Demo project pillar')
        self.manifest(
            addons, 'nasq_registry_probe', ['demo_core'], catalog_check.TEST_ONLY_MARKER,
        )
        (addons / 'demo_pmo' / 'models').mkdir()
        (addons / 'demo_pmo' / 'models' / 'feature_registry.py').write_text(
            REGISTRY % {'features': (
                feature('pmo.enabled', 'boolean', 'demo_pmo', 'demo_pmo')
                + feature('projects.max_projects', 'limit', 'demo_pmo', 'demo_pmo')
            )},
        )
        catalog = self.root / catalog_check.CATALOG_DIR
        (catalog / 'schema').mkdir(parents=True)
        for schema in sorted((REAL_CATALOG / 'schema').glob('*.json')):
            shutil.copy(schema, catalog / 'schema' / schema.name)
        (catalog / 'industries').mkdir()
        self.write('industries/none.json', {
            'schema_version': 1, 'id': 'none', 'name': 'No industry pack',
            'terminology': {}, 'stage_keys': [], 'project_types': [],
        })
        (catalog / 'solutions').mkdir()
        self.data = {
            'schema_version': 1,
            'id': 'demo',
            'name': 'Demo',
            'industry': 'none',
            'base_modules': ['demo_core'],
            'tiers': [{
                'id': 'projects',
                'name': 'Projects',
                'modules': ['demo_pmo'],
                'features': ['boolean:pmo.enabled', 'limit:projects.max_projects'],
            }],
        }
        self.write('solutions/demo.json', self.data)

    def manifest(self, addons, name, depends, summary):
        target = addons / name
        target.mkdir()
        (target / '__manifest__.py').write_text(
            MANIFEST % {'name': name, 'summary': summary, 'depends': depends},
        )

    def write(self, relative, data):
        path = self.root / catalog_check.CATALOG_DIR / relative
        path.write_text(json.dumps(data))
        return path

    def errors(self):
        return catalog_check.check_catalog(self.root)

    def assert_rejected(self, fragment, data=None):
        if data is not None:
            self.write('solutions/demo.json', data)
        errors = self.errors()
        self.assertTrue(
            any(fragment in error for error in errors),
            f'expected an error mentioning {fragment!r}, got {errors}',
        )

    # ---------------------------------------------------------------- positive

    def test_synthetic_catalog_is_valid(self):
        self.assertEqual(self.errors(), [])
        self.assertEqual(catalog_check.main(['--root', str(self.root)]), 0)

    def test_committed_catalog_is_valid(self):
        self.assertEqual(catalog_check.check_catalog(ROOT), [])
        self.assertEqual(catalog_check.main([]), 0)

    def test_bad_usage_is_rejected(self):
        self.assertEqual(catalog_check.main(['--root']), 2)
        self.assertEqual(catalog_check.main(['--nope', 'x']), 2)

    # ------------------------------------------------------------------ schema

    def test_schema_rejects_a_price_field(self):
        self.data['tiers'][0]['price'] = 199
        self.assert_rejected('unexpected property', self.data)

    def test_schema_rejects_missing_required_property(self):
        del self.data['base_modules']
        self.assert_rejected('missing required property', self.data)

    def test_schema_rejects_a_null_limit_and_a_negative_limit(self):
        for bad in (None, -1, '5', True):
            with self.subTest(limit=bad):
                data = json.loads(json.dumps(self.data))
                data['tiers'][0]['limits'] = {'projects.max_projects': bad}
                data['tiers'][0]['limits']['pmo.enabled'] = 1
                self.assert_rejected('limits', data)

    def test_schema_rejects_duplicate_entries_and_bad_ids(self):
        data = json.loads(json.dumps(self.data))
        data['base_modules'] = ['demo_core', 'demo_core']
        self.assert_rejected('unique', data)

    def test_schema_rejects_unknown_type_and_wrong_prefix(self):
        data = json.loads(json.dumps(self.data))
        data['tiers'][0]['features'] = ['boolean:pmo.enabled', 'limit:pmo.enabled']
        self.assert_rejected('not \'limit\'', data)

    def test_unsupported_schema_keyword_is_refused(self):
        schema = json.loads((REAL_CATALOG / 'schema' / 'solution.schema.json').read_text(encoding='utf-8'))
        schema['properties']['id']['maxLength'] = 10
        with self.assertRaises(catalog_check.SchemaError):
            catalog_check._assert_supported(schema)

    def test_invalid_json_is_reported_as_a_schema_error(self):
        path = self.root / catalog_check.CATALOG_DIR / 'solutions' / 'demo.json'
        path.write_text('{')
        with self.assertRaises(catalog_check.SchemaError):
            self.errors()

    # ---------------------------------------------------------------- semantic

    def test_unknown_module_is_rejected(self):
        self.data['base_modules'] = ['demo_core', 'ghost_module']
        self.assert_rejected('ghost_module', self.data)

    def test_module_file_name_must_match_its_id(self):
        path = self.write('solutions/other.json', self.data)
        self.assert_rejected('must match the file name')
        self.assertTrue(path.exists())

    def test_duplicate_tier_id_is_rejected(self):
        self.data['tiers'].append(dict(self.data['tiers'][0]))
        self.assert_rejected('duplicate tier id', self.data)

    def test_base_and_optional_overlap_is_rejected(self):
        self.data['tiers'][0]['modules'] = ['demo_pmo', 'demo_core']
        self.assert_rejected('both a base module and an optional module', self.data)

    def test_unknown_feature_is_rejected(self):
        self.data['tiers'][0]['features'] = ['boolean:pmo.enabled', 'boolean:pmo.ghost']
        self.assert_rejected('not declared in the registry', self.data)

    def test_feature_of_an_uninstalled_owner_is_rejected(self):
        self.data['tiers'][0]['modules'] = []
        self.assert_rejected('which this tier does not install', self.data)

    def test_unknown_industry_is_rejected(self):
        self.data['industry'] = 'health'
        self.assert_rejected('health', self.data)

    def test_tier_addon_reference_must_be_declared(self):
        self.data['tiers'][0]['addons'] = ['ghost_addon']
        self.assert_rejected('is not a declared addon', self.data)

    def test_declared_addon_is_accepted_and_its_modules_are_checked(self):
        self.data['addons'] = [{'id': 'extra', 'name': 'Extra', 'modules': ['demo_pmo']}]
        self.data['tiers'][0]['addons'] = ['extra']
        self.assertEqual(self.errors(), [])

    def test_addon_feature_must_be_declared_in_the_registry(self):
        self.data['addons'] = [{
            'id': 'extra', 'name': 'Extra', 'modules': ['demo_pmo'],
            'features': ['boolean:pmo.ghost'],
        }]
        self.assert_rejected('not declared in the registry', self.data)

    def test_addon_feature_prefix_must_match_the_registry_type(self):
        self.data['addons'] = [{
            'id': 'extra', 'name': 'Extra', 'modules': ['demo_pmo'],
            'features': ['limit:pmo.enabled'],
        }]
        self.assert_rejected("not 'limit'", self.data)

    def test_addon_feature_owner_must_be_installed_by_the_addon(self):
        self.data['addons'] = [{
            'id': 'extra', 'name': 'Extra', 'modules': ['demo_core'],
            'features': ['boolean:pmo.enabled'],
        }]
        self.assert_rejected('this addon does not install', self.data)

    def test_base_module_declared_as_an_addon_module_is_rejected(self):
        self.data['addons'] = [{'id': 'extra', 'name': 'Extra', 'modules': ['demo_core']}]
        self.assert_rejected('both a base module and an optional module', self.data)

    def test_module_declared_by_two_addons_is_rejected(self):
        self.data['addons'] = [
            {'id': 'extra', 'name': 'Extra', 'modules': ['demo_pmo']},
            {'id': 'more', 'name': 'More', 'modules': ['demo_pmo']},
        ]
        self.assert_rejected('is declared by both', self.data)

    def test_tier_cannot_borrow_an_unreferenced_addons_modules(self):
        """A sibling addon's modules are not installed by a tier that ignores it."""
        self.data['addons'] = [{'id': 'extra', 'name': 'Extra', 'modules': ['demo_pmo']}]
        self.data['tiers'][0]['modules'] = []
        self.assert_rejected('this tier does not install', self.data)

    def test_tier_may_use_the_modules_of_the_addon_it_references(self):
        self.data['addons'] = [{'id': 'extra', 'name': 'Extra', 'modules': ['demo_pmo']}]
        self.data['tiers'][0]['modules'] = []
        self.data['tiers'][0]['addons'] = ['extra']
        self.assertEqual(self.errors(), [])

    def test_missing_nasq_dependency_is_rejected(self):
        addons = self.root / 'odoo-addons'
        (addons / 'demo_pmo' / '__manifest__.py').write_text(MANIFEST % {
            'name': 'demo_pmo', 'summary': 'Demo', 'depends': ['demo_core', 'nasq_ghost'],
        })
        self.assert_rejected('nasq_ghost')

    def test_registry_declared_dependency_without_a_manifest_is_rejected(self):
        """A module the registry owns must also ship a manifest."""
        addons = self.root / 'odoo-addons'
        (addons / 'demo_pmo' / '__manifest__.py').write_text(MANIFEST % {
            'name': 'demo_pmo', 'summary': 'Demo', 'depends': ['demo_core', 'nasq_shadow'],
        })
        (addons / 'demo_pmo' / 'models' / 'module_registry.py').write_text(
            "# Part of Odoo. See LICENSE file for full copyright and licensing details.\n"
            "from odoo import api, models\n\n\n"
            "class Shadow(models.AbstractModel):\n"
            "    _inherit = 'nasq.feature.registry'\n\n"
            "    @api.model\n"
            "    def _nasq_module_definitions(self):\n"
            "        return ({'id': 'nasq_shadow'},)\n",
        )
        self.assert_rejected("nasq_shadow' is missing")

    def test_schema_type_value_must_be_implemented(self):
        path = REAL_CATALOG / 'schema' / 'solution.schema.json'
        schema = json.loads(path.read_text(encoding='utf-8'))
        schema['properties']['id']['type'] = 'number'
        with self.assertRaises(catalog_check.SchemaError):
            catalog_check._assert_supported(schema)

    def test_unimplemented_type_in_a_nested_node_is_refused(self):
        schema = {
            'type': 'object',
            'properties': {'entries': {'type': 'array', 'items': {'type': 'weird'}}},
        }
        with self.assertRaises(catalog_check.SchemaError):
            catalog_check._assert_supported(schema)

    def test_addon_features_are_validated_against_the_registry(self):
        """The shared helper is what makes an addon feature checkable at all."""
        declared = catalog_check._check_features(
            ['boolean:pmo.enabled'], 'where', {'demo_pmo'}, 'this addon',
            {'pmo.enabled': {'type': 'boolean', 'module': 'demo_pmo'}}, set(), [],
        )
        self.assertEqual(declared, set())

    def test_limit_ceiling_for_an_undeclared_feature_is_rejected(self):
        self.data['tiers'][0]['features'] = ['boolean:pmo.enabled']
        self.data['tiers'][0]['limits'] = {'projects.max_projects': 5}
        self.assert_rejected('the tier does not declare', self.data)

    def test_declared_limit_ceiling_is_accepted(self):
        self.data['tiers'][0]['limits'] = {'projects.max_projects': 5}
        self.assertEqual(self.errors(), [])

    def test_limit_entry_must_be_a_limit_feature(self):
        self.data['tiers'][0]['limits'] = {'pmo.enabled': 5}
        self.assert_rejected('is not a limit feature', self.data)

    def test_test_only_module_cannot_be_sold(self):
        self.data['base_modules'] = ['demo_core', 'nasq_registry_probe']
        self.assert_rejected('test-only', self.data)

    def test_test_only_marker_is_verified(self):
        manifest = self.root / 'odoo-addons' / 'nasq_registry_probe' / '__manifest__.py'
        manifest.write_text(MANIFEST % {
            'name': 'probe', 'summary': 'something else', 'depends': ['demo_core'],
        })
        self.assert_rejected('no longer says')

    def test_dependency_cycle_is_rejected(self):
        addons = self.root / 'odoo-addons'
        manifest = addons / 'demo_core' / '__manifest__.py'
        manifest.write_text(MANIFEST % {
            'name': 'demo_core', 'summary': 'Demo core', 'depends': ['demo_pmo'],
        })
        self.assert_rejected('dependency cycle')

    def test_dependency_outside_odoo_addons_is_treated_as_external(self):
        """Odoo core dependencies are not resolvable here and must not fail the check."""
        addons = self.root / 'odoo-addons'
        (addons / 'demo_pmo' / '__manifest__.py').write_text(MANIFEST % {
            'name': 'demo_pmo', 'summary': 'Demo', 'depends': ['project', 'ghost_core'],
        })
        self.assertEqual(self.errors(), [])

    def test_duplicate_registry_key_is_refused(self):
        path = self.root / 'odoo-addons' / 'demo_pmo' / 'models' / 'feature_registry.py'
        path.write_text(REGISTRY % {'features': (
            feature('pmo.enabled', 'boolean', 'demo_pmo', 'demo_pmo')
            + feature('pmo.enabled', 'boolean', 'demo_pmo', 'demo_pmo')
        )})
        with self.assertRaises(catalog_check.SchemaError):
            self.errors()

    def test_registry_is_read_from_source(self):
        features, modules = catalog_check.read_registry(self.root)
        self.assertEqual(features['pmo.enabled']['type'], 'boolean')
        self.assertEqual(features['projects.max_projects']['type'], 'limit')
        self.assertIn('demo_pmo', modules)

    def test_committed_registry_matches_the_committed_catalog(self):
        features, _ = catalog_check.read_registry(ROOT)
        solution = json.loads(
            (REAL_CATALOG / 'solutions' / 'platform.json').read_text(encoding='utf-8'),
        )
        named = {
            entry.partition(':')[2]
            for tier in solution['tiers']
            for entry in tier['features']
        }
        self.assertTrue(named.issubset(set(features)), sorted(named - set(features)))

    def test_solution_files_exist(self):
        self.assertTrue((REAL_CATALOG / 'solutions' / 'platform.json').is_file())
        self.assertTrue((REAL_CATALOG / 'industries' / 'none.json').is_file())

    def test_no_solution_file_is_an_error(self):
        for path in (self.root / catalog_check.CATALOG_DIR / 'solutions').glob('*.json'):
            path.unlink()
        self.assert_rejected('no solution file')

    # ------------------------------------------------------------- boundaries

    def test_checker_never_imports_network_odoo_or_subprocess(self):
        source = Path(catalog_check.__file__).read_text(encoding='utf-8')
        imported = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split('.')[0])
        forbidden = imported & {'socket', 'urllib', 'http', 'requests', 'subprocess', 'odoo'}
        self.assertEqual(forbidden, set(), f'catalog_check.py imports {sorted(forbidden)}')

    def test_committed_catalog_declares_no_commercial_field(self):
        """Prices are a later decision (D16/D09); the catalog must not carry a field for them."""
        catalog = json.loads((REAL_CATALOG / 'solutions' / 'platform.json').read_text(encoding='utf-8'))
        commercial = ('price', 'amount', 'currency', 'sar', 'usd', 'discount', 'invoice')
        keys = set(catalog)
        for tier in catalog['tiers']:
            keys.update(tier)
        for addon in catalog.get('addons') or []:
            keys.update(addon)
        offending = sorted(k for k in keys if any(word in k.lower() for word in commercial))
        self.assertEqual(offending, [], f'the catalog names a commercial field: {offending}')


if __name__ == '__main__':
    unittest.main()
