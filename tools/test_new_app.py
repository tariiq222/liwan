# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import difflib
import io
import json
import re
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
    'odoo-addons/nasq_zzprobe/__init__.py',
    'odoo-addons/nasq_zzprobe/__manifest__.py',
    'odoo-addons/nasq_zzprobe/models/feature_registry.py',
    'odoo-addons/nasq_zzprobe/models/access_service.py',
    'odoo-addons/nasq_zzprobe/models/zzprobe_record.py',
    'odoo-addons/nasq_zzprobe/security/zzprobe_capability_groups.xml',
    'odoo-addons/nasq_zzprobe/security/zzprobe_rules.xml',
    'odoo-addons/nasq_zzprobe/security/ir.model.access.csv',
    'odoo-addons/nasq_zzprobe/data/zzprobe_access_permissions.xml',
    'odoo-addons/nasq_zzprobe/controllers/zzprobe_records.py',
    'odoo-addons/nasq_zzprobe/serializers/zzprobe_record.py',
    'odoo-addons/nasq_zzprobe/tests/common.py',
    'odoo-addons/nasq_zzprobe/tests/test_zzprobe_access_composition.py',
    'odoo-addons/nasq_zzprobe/tests/test_zzprobe_records.py',
    'packages/contracts/src/zzprobe/index.ts',
    'packages/contracts/src/zzprobe/__tests__/schemas.test.ts',
    'apps/web/app/modules/zzprobe/manifest.ts',
    'apps/web/app/pages/zzprobe/index.vue',
    'apps/web/i18n/locales/ar/zzprobe.json',
    'apps/web/i18n/locales/en/zzprobe.json',
)
ARGS = ['zzprobe', '--name-ar', 'المسبار', '--name-en', 'Probe']


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


def strip_leftovers(root):
    """Remove anything a real generated app named like the fixtures would have left in the seed."""
    for pattern in ('odoo-addons/nasq_zzprobe*', 'packages/contracts/src/zzprobe*', 'apps/web/app/modules/zzprobe*',
                    'apps/web/app/pages/zzprobe*'):
        for path in root.glob(pattern):
            shutil.rmtree(path) if path.is_dir() else path.unlink()


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
        strip_leftovers(self.root)
        self.before = {r: (self.root / r).read_text(encoding='utf-8') for r in REGISTRATION}

    def test_creates_the_application_files(self):
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 0, err)
        for relative in EXPECTED:
            self.assertTrue((self.root / relative).is_file(), relative)
        for path in (self.root / 'odoo-addons/nasq_zzprobe').rglob('*.json'):
            json.loads(path.read_text(encoding='utf-8'))
        for relative in EXPECTED:
            if relative.endswith('.json'):
                json.loads((self.root / relative).read_text(encoding='utf-8'))

    def test_generated_model_declares_company_scope(self):
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 0, err)
        model = (self.root / 'odoo-addons/nasq_zzprobe/models/zzprobe_record.py').read_text(encoding='utf-8')
        self.assertIn("_nasq_scope = 'company'", model)

    def test_every_python_file_has_the_odoo_header(self):
        run(self.root, *ARGS)
        paths = list((self.root / 'odoo-addons/nasq_zzprobe').rglob('*.py'))
        self.assertGreaterEqual(len(paths), 10)
        for path in paths:
            self.assertEqual(path.read_text(encoding='utf-8').splitlines()[0], new_app.HEADER, path.name)

    def test_manifest_license_version_author(self):
        run(self.root, *ARGS)
        manifest = eval((self.root / 'odoo-addons/nasq_zzprobe/__manifest__.py').read_text(encoding='utf-8'))  # noqa: S307
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
        self.assertEqual([line.strip() for line in added if 'nasq_zzprobe' in line], ['"nasq_zzprobe": 4,'])
        ranks = json.loads(self.before[new_app.ARCH_LAYERS])['ranks']
        anchor = [key for key, rank in ranks.items() if rank == new_app.APPLICATION_RANK][-1]
        keys = list(json.loads(after[new_app.ARCH_LAYERS])['ranks'])
        self.assertEqual(keys[keys.index(anchor) + 1], 'nasq_zzprobe')
        # The anchor line only gains a comma when it was the last entry of the object.
        self.assertTrue(all(line.strip() == f'"{anchor}": 4' for line in removed), removed)
        self.assertTrue(any('"zzprobe": {' in line for line in added))
        self.assertEqual(json.loads(after[new_app.ARCH_LAYERS])['web_apps']['zzprobe'], {'components': ['zzprobe'], 'pages': ['zzprobe']})
        removed, added = changed_lines(self.before[new_app.PLATFORM_SOLUTION], after[new_app.PLATFORM_SOLUTION])
        self.assertFalse([line for line in removed if line.strip() not in ('}', '    }', '}', '  ]')])
        tier = json.loads(after[new_app.PLATFORM_SOLUTION])['tiers'][-1]
        self.assertEqual(tier['modules'], ['nasq_zzprobe'])
        self.assertEqual(tier['features'], ['boolean:zzprobe.enabled'])
        removed, added = changed_lines(self.before[new_app.CONTRACTS_INDEX], after[new_app.CONTRACTS_INDEX])
        self.assertEqual((removed, added), ([], ["export * from './zzprobe'"]))

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
        self.assertIn('nasq_zzprobe', release)

    def test_release_copies_are_synced(self):
        code, out, _ = run(self.root, *ARGS)
        self.assertEqual(code, 0)
        self.assertIn('SYNCED deploy/provision.sh', out)
        self.assertIn('nasq_zzprobe', (self.root / 'deploy/provision.sh').read_text(encoding='utf-8'))

    def test_rail_order_and_shortcut_are_computed_from_existing_manifests(self):
        run(self.root, *ARGS)
        text = (self.root / 'apps/web/app/modules/zzprobe/manifest.ts').read_text(encoding='utf-8')
        others = ''.join(
            path.read_text(encoding='utf-8')
            for path in (self.root / 'apps/web/app/modules').glob('*/manifest.ts') if path.parent.name != 'zzprobe'
        )
        highest = max(int(n) for n in re.findall(r'\border:\s*(\d+)', others))
        self.assertIn(f'order: {highest + 10} ', text)
        shortcut = re.search(r"shortcut: '([a-z0-9])'", text).group(1)
        self.assertNotIn(f"shortcut: '{shortcut}'", others)
        code, _, _ = run(self.root, 'zzprobe_two', '--name-ar', 'ع', '--name-en', 'Probe Two')
        self.assertEqual(code, 0)
        second = (self.root / 'apps/web/app/modules/zzprobe_two/manifest.ts').read_text(encoding='utf-8')
        self.assertIn(f'order: {highest + 20} ', second)
        self.assertNotIn(f"shortcut: '{shortcut}'", second)

    def test_locale_files_define_every_key_the_web_files_use(self):
        run(self.root, *ARGS)
        keys = set()
        for relative in ('apps/web/app/modules/zzprobe/manifest.ts', 'apps/web/app/pages/zzprobe/index.vue'):
            keys |= set(re.findall(r"(?:labelKey: |\bt\()'(zzprobe\.[a-zA-Z.]+)'", (self.root / relative).read_text(encoding='utf-8')))
        self.assertTrue(keys)
        for lang in ('ar', 'en'):
            data = json.loads((self.root / f'apps/web/i18n/locales/{lang}/zzprobe.json').read_text(encoding='utf-8'))
            for key in keys:
                node = data
                for part in key.split('.'):
                    node = node[part]
                self.assertIsInstance(node, str, key)

    def test_dry_run_writes_nothing(self):
        snapshot = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        code, out, _ = run(self.root, *ARGS, '--dry-run')
        self.assertEqual(code, 0)
        self.assertIn('WOULD CREATE odoo-addons/nasq_zzprobe/__manifest__.py', out)
        self.assertEqual(snapshot, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_invalid_ids_are_refused(self):
        ids = (
            'Zzprobe', 'a', '1zzprobe', 'zzprobe-x', 'x' * 22, 'a_', '_a', 'a__b', 'zz probe',
            'hr', 'pmo', 'chat', 'meetings', 'core', 'web', 'tools', 'notify', 'api',
            'notification_digests', 'index', 'search', 'account', 'vendor', 'notifications', 'subscription', 'access', 'common',
            'nasq_zzprobe', 'customer', 'customer_zzprobe', 'customerzzprobe',
        )
        for app in ids:
            code, _, err = run(self.root, app, '--name-ar', 'س', '--name-en', 'S')
            self.assertEqual(code, 1, app)
            self.assertIn('NEW_APP_REFUSED', err)
        self.assertFalse((self.root / 'odoo-addons/nasq_reports').exists())

    def test_ids_colliding_with_foundation_tokens_are_refused(self):
        for app in ('mail', 'res', 'project'):
            code, _, err = run(self.root, app, '--name-ar', 'س', '--name-en', 'S')
            self.assertEqual(code, 1, app)
            self.assertIn('NEW_APP_REFUSED', err)
            self.assertIn('R2', err)
            self.assertFalse((self.root / f'odoo-addons/nasq_{app}').exists())

    def test_a_clean_id_passes_the_foundation_token_check(self):
        code, _, err = run(self.root, *ARGS, '--dry-run')
        self.assertEqual(code, 0, err)

    def test_success_prints_the_catalog_warning(self):
        code, out, err = run(self.root, *ARGS)
        self.assertEqual(code, 0, err)
        self.assertIn('platform_v4.json was edited in place', out)
        self.assertIn('platform_vN.json', out)

    def test_existing_page_or_contracts_entry_blocks_the_id(self):
        (self.root / 'apps/web/app/pages/zzprobe.vue').write_text('<template><div /></template>\n', encoding='utf-8')
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 1, err)
        (self.root / 'apps/web/app/pages/zzprobe.vue').unlink()
        (self.root / 'packages/contracts/src/zzprobe').mkdir()
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 1, err)

    def test_unsafe_names_are_refused(self):
        for bad in ('Bad "quote"', "it's", 'a|b', 'a@b', '50%', '{x}', '$x', 'a<b', 'a&b', 'back\\slash', 'line\nbreak', ' '):
            for flag in ('--name-en', '--name-ar'):
                other = '--name-ar' if flag == '--name-en' else '--name-en'
                code, _, _ = run(self.root, 'zzprobe', flag, bad, other, 'ok')
                self.assertEqual(code, 1, (flag, bad))
        self.assertFalse((self.root / 'odoo-addons/nasq_zzprobe').exists())

    def test_web_slots_read_double_and_backtick_quotes_and_high_orders(self):
        modules = self.root / 'apps/web/app/modules'
        for path in modules.glob('*/manifest.ts'):
            path.unlink()
        (modules / 'hi').mkdir(exist_ok=True)
        (modules / 'hi/manifest.ts').write_text(
            'export default { rail: [{ id: "hi", order: 990 }], nav: [{ shortcut: "a" }, { shortcut: `b` }, { shortcut: \'c\' }] }\n',
            encoding='utf-8',
        )
        order, shortcut = new_app.web_slots(self.root)
        self.assertEqual(order, 1000)
        self.assertEqual(shortcut, 'd')

    def test_hard_wired_keys_are_never_chosen(self):
        modules = self.root / 'apps/web/app/modules'
        for path in modules.glob('*/manifest.ts'):
            path.unlink()
        (self.root / 'apps/web/app/composables/nav/shellModules.ts').unlink()
        letters = ''.join(c for c in 'abcdefghijklmnopqrstuvwxyz0123456789' if c not in 'cgjk')
        (modules / 'full').mkdir(exist_ok=True)
        (modules / 'full/manifest.ts').write_text(
            'export default { order: 1, nav: [' + ','.join(f"{{ shortcut: '{c}' }}" for c in letters[:-1]) + '] }\n', encoding='utf-8',
        )
        self.assertEqual(new_app.web_slots(self.root)[1], letters[-1])

    def test_hard_wired_keys_match_the_shell_keymap(self):
        keymap = (Path(new_app.__file__).resolve().parents[1] / 'packages/ui/app/composables/shortcuts/keymap.ts').read_text(encoding='utf-8')
        declared = re.search(r'SHELL_RESERVED_KEYS[^=]*=\s*\[([^\]]*)\]', keymap).group(1)
        keys = set(re.findall(r"'([^']+)'", declared))
        self.assertEqual({key for key in keys if re.fullmatch('[a-z0-9]', key)}, set(new_app.HARD_WIRED_SHORTCUTS))

    def test_shell_keymap_letters_are_never_chosen(self):
        modules = self.root / 'apps/web/app/modules'
        for path in modules.glob('*/manifest.ts'):
            path.unlink()
        (self.root / 'apps/web/app/composables/nav/shellModules.ts').unlink()
        (modules / 'hi').mkdir(exist_ok=True)
        (modules / 'hi/manifest.ts').write_text(
            "export default { rail: [{ id: 'hi', order: 990 }], nav: ["
            "{ shortcut: 'a' }, { shortcut: 'b' }, { shortcut: 'd' }, { shortcut: 'e' }, { shortcut: 'f' }] }\n",
            encoding='utf-8',
        )
        self.assertEqual(new_app.web_slots(self.root)[1], 'h')

    def test_missing_order_or_shortcut_fails_loudly(self):
        for path in (self.root / 'apps/web/app/modules').glob('*/manifest.ts'):
            path.write_text('export default {}\n', encoding='utf-8')
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 1)
        self.assertIn('NEW_APP_REFUSED', err)
        self.assertFalse((self.root / 'odoo-addons/nasq_zzprobe').exists())

    def _snapshot(self):
        return {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}, {p for p in self.root.rglob('*') if p.is_dir()}

    def test_a_failing_sync_rolls_everything_back(self):
        before = self._snapshot()
        original = catalog_check.sync_release_copies

        def failing(root, *args, **kwargs):
            original(root, *args, **kwargs)  # sync really writes, then the step fails
            raise RuntimeError('boom')

        catalog_check.sync_release_copies = failing
        try:
            new_app_module = new_app._catalog_module
            new_app._catalog_module = lambda: catalog_check
            code, _, err = run(self.root, *ARGS)
        finally:
            catalog_check.sync_release_copies = original
            new_app._catalog_module = new_app_module
        self.assertEqual(code, 1)
        self.assertIn('rolled back', err)
        self.assertEqual(before, self._snapshot())

    def test_a_failing_catalog_check_rolls_everything_back(self):
        before = self._snapshot()
        original = catalog_check.check_catalog
        catalog_check.check_catalog = lambda root: ['forced failure']
        try:
            new_app_module = new_app._catalog_module
            new_app._catalog_module = lambda: catalog_check
            code, _, err = run(self.root, *ARGS)
        finally:
            catalog_check.check_catalog = original
            new_app._catalog_module = new_app_module
        self.assertEqual(code, 1)
        self.assertIn('forced failure', err)
        self.assertEqual(before, self._snapshot())

    def test_multi_word_ids_use_pascal_case_classes(self):
        code, _, err = run(self.root, 'zzprobe_ops', '--name-ar', 'العمليات', '--name-en', 'Probe Ops')
        self.assertEqual(code, 0, err)
        text = (self.root / 'odoo-addons/nasq_zzprobe_ops/models/access_service.py').read_text(encoding='utf-8')
        self.assertIn('class NasqZzprobeOpsAccessService', text)

    def test_route_defaults_to_the_app_id(self):
        code, _, err = run(self.root, *ARGS)
        self.assertEqual(code, 0, err)
        manifest = (self.root / 'apps/web/app/modules/zzprobe/manifest.ts').read_text(encoding='utf-8')
        self.assertIn("routePrefixes: ['/zzprobe']", manifest)
        layers = json.loads((self.root / new_app.ARCH_LAYERS).read_text(encoding='utf-8'))
        self.assertEqual(layers['web_apps']['zzprobe'], {'components': ['zzprobe'], 'pages': ['zzprobe']})
        self.assertFalse(list(self.root.rglob('*__route__*')))

    def test_route_drives_pages_manifest_and_arch_layers(self):
        code, _, err = run(self.root, *ARGS, '--route', 'my-probe')
        self.assertEqual(code, 0, err)
        self.assertTrue((self.root / 'apps/web/app/pages/my-probe/index.vue').is_file())
        self.assertFalse((self.root / 'apps/web/app/pages/zzprobe').exists())
        manifest = (self.root / 'apps/web/app/modules/zzprobe/manifest.ts').read_text(encoding='utf-8')
        self.assertIn("routePrefixes: ['/my-probe']", manifest)
        self.assertIn("to: '/my-probe'", manifest)
        self.assertIn('/^\\/my-probe(?:\\/|$)/', manifest)
        self.assertIn("feature: 'zzprobe.enabled'", manifest)
        self.assertNotIn('{{route}}', manifest)
        layers = json.loads((self.root / new_app.ARCH_LAYERS).read_text(encoding='utf-8'))
        self.assertEqual(layers['web_apps']['zzprobe'], {'components': ['my-probe'], 'pages': ['my-probe']})
        self.assertTrue((self.root / 'odoo-addons/nasq_zzprobe/__manifest__.py').is_file())

    def test_reserved_route_id_needs_a_distinct_route(self):
        # `tasks` is a shell route; `notification_digests` is a page route taken by pages/notification-digests/.
        for app in ('tasks', 'notification_digests'):
            for extra in ((), ('--route', app)):
                code, _, err = run(self.root, app, *extra, '--name-ar', 'س', '--name-en', 'S')
                self.assertEqual(code, 1, (app, extra))
                self.assertIn('NEW_APP_REFUSED', err)
        code, _, err = run(self.root, 'notification_digests', '--route', 'my-digests', '--name-ar', 'الملخصات', '--name-en', 'Digests')
        self.assertEqual(code, 0, err)
        for relative in ('apps/web/app/modules/notification_digests', 'odoo-addons/nasq_notification_digests', 'apps/web/app/pages/my-digests'):
            self.assertTrue((self.root / relative).is_dir(), relative)

    def test_edge_proxy_routes_are_reserved(self):
        # The edge sends /odoo and /websocket to Odoo, so no application page may use them.
        for app in ('odoo', 'websocket'):
            for extra in ((), ('--route', app)):
                code, _, err = run(self.root, app, *extra, '--name-ar', 'س', '--name-en', 'S')
                self.assertEqual(code, 1, (app, extra))
                self.assertIn('NEW_APP_REFUSED', err)
        code, _, err = run(self.root, *ARGS, '--route', 'odoo')
        self.assertEqual(code, 1, err)
        self.assertIn('NEW_APP_REFUSED', err)

    def test_route_colliding_with_an_existing_page_is_refused(self):
        code, _, err = run(self.root, *ARGS, '--route', 'projects')
        self.assertEqual(code, 1)
        self.assertIn('NEW_APP_REFUSED', err)
        self.assertFalse((self.root / 'odoo-addons/nasq_zzprobe').exists())

    def test_invalid_route_slug_is_refused(self):
        for route in ('My_Tasks', '-x', '', 'a--b', 'x-', '1x'):
            code, _, err = run(self.root, *ARGS, f'--route={route}')
            self.assertEqual(code, 1, route)
            self.assertIn('NEW_APP_REFUSED', err)
        self.assertFalse((self.root / 'odoo-addons/nasq_zzprobe').exists())

    def test_the_new_application_with_a_route_passes_the_policies(self):
        code, _, err = run(self.root, 'reports', '--route', 'my-reports', '--name-ar', 'التقارير', '--name-en', 'Reports')
        self.assertEqual(code, 0, err)
        with contextlib.redirect_stderr(io.StringIO()) as err:
            code = arch_policy.main(
                [], root=self.root, layers_file=self.root / new_app.ARCH_LAYERS,
                baseline_file=self.root / 'tools/arch_baseline.json',
            )
        self.assertEqual(code, 0, err.getvalue())
        self.assertEqual(catalog_check.check_catalog(self.root), [])

    def test_route_drives_the_locale_file_and_namespace(self):
        code, _, err = run(self.root, 'reports', '--route', 'my-reports', '--name-ar', 'التقارير', '--name-en', 'Reports')
        self.assertEqual(code, 0, err)
        locales = self.root / 'apps/web/i18n/locales'
        for lang in ('ar', 'en'):
            self.assertTrue((locales / lang / 'my-reports.json').is_file(), lang)
            self.assertFalse((locales / lang / 'reports.json').exists(), lang)
            data = json.loads((locales / lang / 'my-reports.json').read_text(encoding='utf-8'))
            self.assertEqual(list(data), ['myReports'])
        manifest = (self.root / 'apps/web/app/modules/reports/manifest.ts').read_text(encoding='utf-8')
        self.assertIn("labelKey: 'myReports.title'", manifest)
        self.assertIn("labelKey: 'myReports.nav.records'", manifest)
        self.assertIn("capability: 'reports.records.read'", manifest)
        self.assertNotIn("labelKey: 'reports.", manifest)

    def test_locale_files_define_every_key_with_a_route(self):
        run(self.root, *ARGS, '--route', 'my-probe')
        keys = set()
        for relative in ('apps/web/app/modules/zzprobe/manifest.ts', 'apps/web/app/pages/my-probe/index.vue'):
            keys |= set(re.findall(r"(?:labelKey: |\bt\()'(myProbe\.[a-zA-Z.]+)'", (self.root / relative).read_text(encoding='utf-8')))
        self.assertTrue(keys)
        for lang in ('ar', 'en'):
            data = json.loads((self.root / f'apps/web/i18n/locales/{lang}/my-probe.json').read_text(encoding='utf-8'))
            for key in keys:
                node = data
                for part in key.split('.'):
                    node = node[part]
                self.assertIsInstance(node, str, key)


if __name__ == '__main__':
    unittest.main()
