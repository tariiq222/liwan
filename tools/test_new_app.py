# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import difflib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import arch_policy  # noqa: E402
import catalog_check  # noqa: E402
import new_app  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
REGISTRATION = (new_app.ARCH_LAYERS, new_app.PLATFORM_SOLUTION, new_app.CONTRACTS_INDEX)
EXPECTED = (
    'odoo-addons/nasq_sales/__init__.py',
    'odoo-addons/nasq_sales/__manifest__.py',
    'odoo-addons/nasq_sales/models/feature_registry.py',
    'odoo-addons/nasq_sales/models/access_service.py',
    'odoo-addons/nasq_sales/models/sales_record.py',
    'odoo-addons/nasq_sales/security/sales_capability_groups.xml',
    'odoo-addons/nasq_sales/security/sales_rules.xml',
    'odoo-addons/nasq_sales/security/ir.model.access.csv',
    'odoo-addons/nasq_sales/data/sales_access_permissions.xml',
    'odoo-addons/nasq_sales/controllers/sales_records.py',
    'odoo-addons/nasq_sales/serializers/sales_record.py',
    'odoo-addons/nasq_sales/tests/common.py',
    'odoo-addons/nasq_sales/tests/test_sales_access_composition.py',
    'odoo-addons/nasq_sales/tests/test_sales_records.py',
    'packages/contracts/src/sales/index.ts',
    'apps/web/app/modules/sales/manifest.ts',
    'apps/web/app/pages/sales/index.vue',
    'apps/web/i18n/locales/ar/sales.json',
    'apps/web/i18n/locales/en/sales.json',
)
ARGS = ['sales', '--name-ar', 'المبيعات', '--name-en', 'Sales']


def seed(root):
    """The slice of the repository the generator reads or edits, plus what the policies scan."""
    skip = shutil.ignore_patterns('__pycache__', '*.pyc', 'static', 'i18n', 'node_modules')
    for relative in (*REGISTRATION, 'tools/arch_baseline.json', *catalog_check.RELEASE_COPIES):
        source = REPO / relative
        if source.is_file():
            (root / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(source, root / relative)
    for relative in ('deploy/catalog', 'odoo-addons', 'apps/web/app/pages', 'apps/web/app/components', 'apps/web/app/modules', 'apps/web/app/composables', 'apps/web/app/utils'):
        shutil.copytree(REPO / relative, root / relative, ignore=skip, dirs_exist_ok=True)


def run(root, *args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = new_app.main([*args, '--root', str(root)])
    return code, out.getvalue(), err.getvalue()


def changed_lines(before, after):
    removed, added = [], []
    for line in difflib.unified_diff(before.splitlines(), after.splitlines(), lineterm='', n=0):
        if line.startswith(('---', '+++', '@@')):
            continue
        (added if line.startswith('+') else removed).append(line[1:])
    return removed, added


class TestNewApp(unittest.TestCase):

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        seed(self.root)
        self.before = {r: (self.root / r).read_text(encoding='utf-8') for r in REGISTRATION}

    def test_creates_the_application_files(self):
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 0, err)
        for relative in EXPECTED:
            self.assertTrue((self.root / relative).is_file(), relative)
        for path in (self.root / 'odoo-addons/nasq_sales').rglob('*.json'):
            json.loads(path.read_text(encoding='utf-8'))
        for relative in EXPECTED:
            if relative.endswith('.json'):
                json.loads((self.root / relative).read_text(encoding='utf-8'))

    def test_every_python_file_has_the_odoo_header(self):
        run(self.root, *ARGS)
        paths = list((self.root / 'odoo-addons/nasq_sales').rglob('*.py'))
        self.assertGreaterEqual(len(paths), 10)
        for path in paths:
            self.assertEqual(path.read_text(encoding='utf-8').splitlines()[0], new_app.HEADER, path.name)

    def test_manifest_license_version_author(self):
        run(self.root, *ARGS)
        manifest = eval((self.root / 'odoo-addons/nasq_sales/__manifest__.py').read_text(encoding='utf-8'))  # noqa: S307
        self.assertEqual(manifest['license'], 'LGPL-3')
        self.assertEqual(manifest['version'], '19.0.1.0.0')
        self.assertEqual(manifest['author'], 'Tariq Alwalidi')
        self.assertEqual(manifest['depends'], ['nasq_api'])

    def test_no_placeholder_survives(self):
        run(self.root, *ARGS)
        for relative in EXPECTED:
            text = (self.root / relative).read_text(encoding='utf-8')
            for token in ('{{app}}', '{{App}}', '{{name_ar}}', '{{name_en}}', '__app__'):
                self.assertNotIn(token, text, relative)

    def test_second_run_is_refused_and_changes_nothing(self):
        self.assertEqual(run(self.root, *ARGS)[0], 0)
        snapshot = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 1)
        self.assertIn('NEW_APP_REFUSED', err)
        self.assertEqual(snapshot, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_only_the_intended_lines_change_in_registration_files(self):
        run(self.root, *ARGS)
        after = {r: (self.root / r).read_text(encoding='utf-8') for r in REGISTRATION}
        removed, added = changed_lines(self.before[new_app.ARCH_LAYERS], after[new_app.ARCH_LAYERS])
        self.assertEqual([line.strip() for line in added if 'nasq_sales' in line], ['"nasq_sales": 4,'])
        self.assertTrue(all(line.strip() in ('"nasq_chat": 4', '"nasq_chat": 4,') or 'nasq_chat' in line for line in removed))
        self.assertTrue(any('"sales": {' in line for line in added))
        self.assertEqual(json.loads(after[new_app.ARCH_LAYERS])['web_apps']['sales'], {'components': ['sales'], 'pages': ['sales']})
        removed, added = changed_lines(self.before[new_app.PLATFORM_SOLUTION], after[new_app.PLATFORM_SOLUTION])
        self.assertFalse([line for line in removed if line.strip() not in ('}', '    }', '}', '  ]')])
        tier = json.loads(after[new_app.PLATFORM_SOLUTION])['tiers'][-1]
        self.assertEqual(tier['modules'], ['nasq_sales'])
        self.assertEqual(tier['features'], ['boolean:sales.enabled'])
        removed, added = changed_lines(self.before[new_app.CONTRACTS_INDEX], after[new_app.CONTRACTS_INDEX])
        self.assertEqual((removed, added), ([], ["export * from './sales'"]))

    def test_the_new_application_passes_the_policies(self):
        run(self.root, *ARGS)
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code = arch_policy.main(
                [], root=self.root, layers_file=self.root / new_app.ARCH_LAYERS,
                baseline_file=self.root / 'tools/arch_baseline.json',
            )
        self.assertEqual(code, 0, err.getvalue())
        self.assertEqual(catalog_check.check_catalog(self.root), [])
        release = catalog_check.current_release(self.root)[1]
        self.assertIn('nasq_sales', release)

    def test_release_copies_are_synced(self):
        code, out, _ = run(self.root, *ARGS)
        self.assertEqual(code, 0)
        self.assertIn('SYNCED deploy/provision.sh', out)
        self.assertIn('nasq_sales', (self.root / 'deploy/provision.sh').read_text(encoding='utf-8'))

    def test_dry_run_writes_nothing(self):
        snapshot = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        code, out, _ = run(self.root, *ARGS, '--dry-run')
        self.assertEqual(code, 0)
        self.assertIn('WOULD CREATE odoo-addons/nasq_sales/__manifest__.py', out)
        self.assertEqual(snapshot, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_invalid_names_are_refused(self):
        for app in ('Sales', 'a', '1sales', 'sales-x', 'x' * 22, 'hr', 'pmo', 'chat', 'meetings', 'core', 'web', 'tools', 'notify', 'api'):
            code, _, err = run(self.root, app, '--name-ar', 'س', '--name-en', 'S')
            self.assertEqual(code, 1, app)
            self.assertIn('NEW_APP_REFUSED', err)
        code, _, _ = run(self.root, 'sales', '--name-ar', 'س', '--name-en', 'Bad "quote"')
        self.assertEqual(code, 1)
        self.assertFalse((self.root / 'odoo-addons/nasq_sales').exists())

    def test_multi_word_ids_use_pascal_case_classes(self):
        code, _, err = run(self.root, 'field_ops', '--name-ar', 'العمليات', '--name-en', 'Field Ops')
        self.assertEqual(code, 0, err)
        text = (self.root / 'odoo-addons/nasq_field_ops/models/access_service.py').read_text(encoding='utf-8')
        self.assertIn('class NasqFieldOpsAccessService', text)


if __name__ == '__main__':
    unittest.main()
