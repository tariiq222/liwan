# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Prevent older worktrees from reintroducing the retired product namespace."""
import ast
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS_NAMESPACE = 'nasq'  # Retired identifier is deliberately named by this regression guard.
TEXT_SUFFIXES = {'.py', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.css', '.scss',
                 '.json', '.toml', '.yaml', '.yml', '.sh', '.xml', '.csv', '.po', '.pot', '.example', '.mdx',
                 '.sql', '.html', '.conf', '.ini', '.tmpl'}


class ProductNamespaceTest(unittest.TestCase):
    def test_guard_rejects_old_identifiers_in_templates_configs_and_diacritic_brand(self):
        cases = {
            'tools/checkout-path.conf': '/Users/tariq/code/' + PREVIOUS_NAMESPACE + '/odoo-addons',
            'deploy/repository.conf': 'https://github.com/tariiq222/' + PREVIOUS_NAMESPACE + '.git',
            'tools/new_app_templates/model.py.tmpl': 'from odoo.addons.' + PREVIOUS_NAMESPACE + '_api import common',
            'deploy/Caddyfile': 'header X-' + PREVIOUS_NAMESPACE + '-Service-Token value',
            'apps/web/i18n/locales/ar/common.json': json.dumps({'name': 'نَسَق'}, ensure_ascii=False),
        }
        for name, text in cases.items():
            with self.subTest(path=name), tempfile.TemporaryDirectory() as directory:
                temporary = Path(directory)
                subprocess.run(['git', 'init', '-q', str(temporary)], check=True)
                source = temporary / name
                source.parent.mkdir(parents=True)
                source.write_text(text)
                with patch(__name__ + '.ROOT', temporary), self.assertRaises(AssertionError):
                    self.test_active_owned_source_has_no_retired_namespace()

    def test_release_addons_and_workspace_packages_use_product_namespace(self):
        layers = json.loads((ROOT / 'tools/arch_layers.json').read_text())
        self.assertTrue(layers['ranks'])
        for addon in layers['ranks']:
            with self.subTest(addon=addon):
                self.assertTrue(addon.startswith('liwan_') or addon == 'base_tier_validation', addon)
                manifest = ast.literal_eval((ROOT / 'odoo-addons' / addon / '__manifest__.py').read_text())
                self.assertFalse(any(PREVIOUS_NAMESPACE in dep for dep in manifest.get('depends', [])))
        for manifest in (ROOT / 'packages').glob('*/package.json'):
            with self.subTest(package=str(manifest.relative_to(ROOT))):
                self.assertTrue(json.loads(manifest.read_text())['name'].startswith('@liwan/'))

    def test_active_owned_source_has_no_retired_namespace(self):
        result = subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                                cwd=ROOT, capture_output=True, check=True)
        pattern = re.compile(PREVIOUS_NAMESPACE, re.IGNORECASE)
        arabic_brand = re.compile(r'\bنسق\b')  # Reject the former brand, preserving words such as منسق.
        failures = []
        for name in sorted(set(result.stdout.decode().split('\0')) - {''}):
            path = ROOT / name
            if not path.is_file() or name.startswith(('docs/', 'plans/')) or path == Path(__file__):
                continue
            if pattern.search(name):
                failures.append(f'{name}: retired namespace in filename')
            if (path.suffix not in TEXT_SUFFIXES
                    and path.name not in {'Dockerfile', 'Caddyfile', 'Makefile', '.gitignore'}
                    and not path.read_bytes().startswith(b'#!')):
                continue
            text = path.read_text(errors='replace')
            text = text.replace('/Users/tariq/Downloads/' + PREVIOUS_NAMESPACE + '-ui', '/physical/reference')
            for number, line in enumerate(text.splitlines(), 1):
                unvocalized = re.sub(r'[\u064b-\u065f\u0670]', '', line)
                if pattern.search(line) or arabic_brand.search(unvocalized):
                    failures.append(f'{name}:{number}')
        self.assertEqual(failures, [], '\n'.join(failures[:60]))
