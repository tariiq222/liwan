# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Catalog checks run offline against a synthetic repository root.

Every negative case builds the smallest repository that must fail, so a passing run
proves the rule fires instead of merely proving the committed catalog is accepted.
"""
import ast
import contextlib
import io
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


class CatalogFixture:
    """A minimal synthetic repository; subclasses add the tests."""

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


class CatalogCase(CatalogFixture, unittest.TestCase):
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


PLATFORM_REGISTRY = """# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class DemoPlatform(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
%(features)s
        )
"""


class ReleaseCatalogCase(CatalogFixture, unittest.TestCase):
    """Schema 3: every release feature in exactly one tier; one release module list."""

    def setUp(self):
        super().setUp()
        models = self.root / 'odoo-addons' / 'demo_core' / 'models'
        models.mkdir()
        (models / 'feature_registry.py').write_text(PLATFORM_REGISTRY % {'features': (
            feature('users.limit', 'limit', 'nasq_platform', 'nasq_platform')
            + feature('storage.limit_mb', 'limit', 'nasq_platform', 'nasq_platform')
            + feature('branches.extra_limit', 'limit', 'nasq_platform', 'nasq_platform')
        )})
        self.data = {
            'schema_version': 3,
            'descriptor_grammar': 'limit:key | limit:key:<int> | boolean:key',
            'id': 'demo', 'name': 'Demo', 'industry': 'none', 'base_modules': ['demo_core'],
            'tiers': [
                {'id': 'core', 'name': 'Core', 'modules': [],
                 'features': ['limit:users.limit', 'limit:storage.limit_mb', 'limit:branches.extra_limit:0']},
                {'id': 'projects', 'name': 'Projects', 'modules': ['demo_pmo'],
                 'features': ['boolean:pmo.enabled', 'limit:projects.max_projects']},
            ],
        }
        self.write('solutions/demo.json', self.data)

    def test_complete_release_is_valid_and_prints_its_modules(self):
        self.assertEqual(self.errors(), [])
        self.assertEqual(catalog_check.current_release(self.root), ('demo.json', ['demo_core', 'demo_pmo']))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(catalog_check.main(['--release-modules', '--root', str(self.root)]), 0)
        self.assertEqual(output.getvalue().strip(), 'demo_core,demo_pmo')

    def test_a_release_feature_in_no_tier_is_rejected(self):
        self.data['tiers'][1]['features'] = ['boolean:pmo.enabled']
        self.assert_rejected("feature 'projects.max_projects' of release module 'demo_pmo' is in no tier", self.data)

    def test_a_feature_in_two_tiers_is_rejected(self):
        self.data['tiers'].append({'id': 'twice', 'name': 'Twice', 'modules': [], 'features': ['boolean:pmo.enabled']})
        self.assert_rejected("feature 'pmo.enabled' is declared by more than one tier", self.data)

    def test_a_tier_with_modules_and_no_features_is_rejected(self):
        self.data['tiers'][1]['features'] = []
        self.assert_rejected("tier 'projects' lists modules but declares no feature", self.data)

    def test_a_feature_owned_outside_the_release_is_rejected(self):
        outside = self.root / 'odoo-addons' / 'demo_outside'
        self.manifest(self.root / 'odoo-addons', 'demo_outside', ['demo_core'], 'Outside the release')
        (outside / 'models').mkdir()
        (outside / 'models' / 'feature_registry.py').write_text(PLATFORM_REGISTRY % {'features': (
            feature('outside.enabled', 'boolean', 'demo_outside', 'demo_outside')
        )})
        self.data['tiers'][1]['features'].append('boolean:outside.enabled')
        self.assert_rejected("feature 'outside.enabled' belongs to module 'demo_outside', which is not in the release", self.data)

    def test_a_stale_copy_of_the_release_list_is_rejected(self):
        (self.root / 'deploy').mkdir(exist_ok=True)
        (self.root / 'deploy' / 'provision.sh').write_text('odoo -i demo_core,web_theme_shadcn --stop-after-init\n')
        self.assert_rejected("deploy/provision.sh: module list ['demo_core'] differs from the release modules")

    def test_the_newest_release_is_chosen_by_numeric_suffix(self):
        self.write('solutions/demo_v3.json', self.data)
        self.write('solutions/demo_v10.json', self.data)
        self.assertEqual(catalog_check.current_release(self.root)[0], 'demo_v10.json')

    def test_no_schema_3_catalog_means_no_release(self):
        self.data['schema_version'] = 2
        self.write('solutions/demo.json', self.data)
        self.assertIsNone(catalog_check.current_release(self.root))
        self.assertEqual(catalog_check.main(['--release-modules', '--root', str(self.root)]), 1)

    def test_the_committed_release_is_the_base_then_the_tier_closures(self):
        name, modules = catalog_check.current_release(ROOT)
        self.assertEqual(name, 'platform_v3.json')
        data = json.loads((ROOT / 'deploy/catalog/solutions' / name).read_text())
        self.assertEqual(data['base_modules'], ['nasq_core', 'nasq_platform', 'nasq_api'])
        order = catalog_check.release_install_order(ROOT, data)
        self.assertEqual(order[:3], data['base_modules'])
        self.assertEqual(sorted(order), modules)
        self.assertEqual(len(order), len(set(order)))
        position = {module: index for index, module in enumerate(order)}
        seen = set(data['base_modules'])
        for tier in data['tiers']:
            closure = catalog_check.install_closure([ROOT / 'odoo-addons'], data['base_modules'] + tier['modules'])
            added = closure - seen
            # a tier's modules come before every module that only a later tier adds
            later = set(order) - seen - added
            for module in added:
                self.assertTrue(all(position[module] < position[other] for other in later))
            seen |= closure

    def test_the_committed_tree_has_no_catalog_errors(self):
        self.assertEqual(catalog_check.check_catalog(ROOT), [])

    def test_a_new_application_must_sit_in_exactly_one_tier(self):
        self.write_layers({'demo_core': 0, 'demo_pmo': 4, 'demo_sales': 4})
        self.assert_rejected("release_app_missing: application 'demo_sales' must be in exactly one tier (found 0)")
        self.data['tiers'][1]['modules'].append('demo_sales')
        self.manifest(self.root / 'odoo-addons', 'demo_sales', ['demo_core'], 'Sales')
        self.data['tiers'].append({'id': 'again', 'name': 'Again', 'modules': ['demo_sales'], 'features': ['boolean:x.enabled']})
        self.assert_rejected("application 'demo_sales' must be in exactly one tier (found 2)", self.data)

    def test_a_tier_module_must_be_registered_in_the_layers(self):
        self.write_layers({'demo_core': 0})
        self.assert_rejected("release_app_missing: tier module 'demo_pmo' is not registered in tools/arch_layers.json")

    def write_layers(self, ranks):
        (self.root / 'tools').mkdir(exist_ok=True)
        (self.root / 'tools' / 'arch_layers.json').write_text(json.dumps({'ranks': ranks}))


class SyncReleaseCopiesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        addons = self.root / 'odoo-addons'
        for name, depends in (('demo_core', []), ('demo_api', ['demo_core']), ('demo_pmo', ['demo_api']),
                              ('demo_hr', ['demo_api'])):
            (addons / name).mkdir(parents=True)
            (addons / name / '__manifest__.py').write_text(repr({'name': name, 'depends': depends}))
        solutions = self.root / 'deploy' / 'catalog' / 'solutions'
        solutions.mkdir(parents=True)
        (solutions / 'demo.json').write_text(json.dumps({
            'schema_version': 3, 'base_modules': ['demo_core', 'demo_api'],
            'tiers': [{'id': 'a', 'modules': ['demo_pmo']}, {'id': 'b', 'modules': ['demo_hr']}],
        }))
        (self.root / 'deploy').mkdir(exist_ok=True)
        self.provision = self.root / 'deploy' / 'provision.sh'
        self.provision.write_text('odoo -i demo_core,demo_api,demo_pmo,web_theme_shadcn --stop-after-init\n')
        self.operations = self.root / 'deploy' / 'OPERATIONS.md'
        self.operations.write_text('--modules demo_core,demo_api\n--test-tags /demo_core,/demo_api\nuntouched demo_hr,x\n')
        self.isolated = self.root / 'deploy' / 'check_isolated.py'
        self.isolated.write_text("X = 1\nNASQ_ADDONS = (\n    'demo_core', 'demo_api',\n)\nY = 2\n")

    def test_rewrites_only_the_lists_and_keeps_foreign_modules(self):
        changed = catalog_check.sync_release_copies(self.root)
        self.assertEqual(sorted(changed), ['deploy/OPERATIONS.md', 'deploy/check_isolated.py', 'deploy/provision.sh'])
        self.assertEqual(
            self.provision.read_text(),
            'odoo -i demo_core,demo_api,demo_pmo,demo_hr,web_theme_shadcn --stop-after-init\n',
        )
        self.assertEqual(
            self.operations.read_text(),
            '--modules demo_core,demo_api,demo_pmo,demo_hr\n'
            '--test-tags /demo_core,/demo_api,/demo_pmo,/demo_hr\nuntouched demo_hr,x\n',
        )
        self.assertEqual(
            self.isolated.read_text(),
            "X = 1\nNASQ_ADDONS = (\n    'demo_core', 'demo_api', 'demo_pmo', 'demo_hr',\n)\nY = 2\n",
        )

    def test_is_idempotent(self):
        catalog_check.sync_release_copies(self.root)
        before = {path: path.read_text() for path in (self.provision, self.operations, self.isolated)}
        self.assertEqual(catalog_check.sync_release_copies(self.root), [])
        self.assertEqual(before, {path: path.read_text() for path in before})

    def test_a_synced_tree_passes_the_copy_guard(self):
        catalog_check.sync_release_copies(self.root)
        errors = []
        catalog_check._check_release_copies(
            self.root, ['demo_core', 'demo_api'], catalog_check.current_release(self.root)[1], errors)
        self.assertEqual(errors, [])

    def test_the_command_reports_what_it_rewrote(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(catalog_check.main(['--sync-release-copies', '--root', str(self.root)]), 0)
        self.assertIn('SYNCED deploy/provision.sh', output.getvalue())

if __name__ == '__main__':
    unittest.main()
