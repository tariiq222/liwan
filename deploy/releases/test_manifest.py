"""Release input and conservative impact classification contracts."""
import json
from pathlib import Path
import tempfile
import unittest

from .manifest import classify_release, load_manifest, validate_manifest


def release(**changes):
    value = {
        'releaseId': 'r20261016', 'liwanCommit': '1' * 40, 'odooCommit': '2' * 40,
        'images': {'odoo': 'liwan/odoo@sha256:' + 'a' * 64, 'web': 'liwan/web@sha256:' + 'b' * 64},
        'assetsId': 'assets-1', 'moduleVersions': {}, 'upgradeModules': [], 'installModules': [],
        'mode': 'online', 'affectedServices': ['web'], 'aiStateVersion': '1',
        'compatibilityEvidence': {'reviewer': 'owner', 'reference': 'review-42',
            'apiCompatible': True, 'sessionCompatible': True, 'concurrentWritesCompatible': True,
            'jobsCompatible': True, 'aiCompatible': True},
        'rollbackPolicy': {'oldWritesCompatible': True},
    }
    value.update(changes)
    return value


class ManifestTests(unittest.TestCase):
    def test_loads_valid_release_and_freezes_nested_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.json'
            path.write_text(json.dumps(release()))
            result = load_manifest(path)
            self.assertEqual(result['releaseId'], 'r20261016')
            with self.assertRaises(TypeError):
                result['images']['web'] = 'mutable:latest'

    def test_online_rejects_module_operations(self):
        for operation in ('upgradeModules', 'installModules'):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                validate_manifest(release(**{operation: ['liwan_core']}))

    def test_rejects_mutable_images_and_missing_evidence(self):
        for patch in ({'images': {'odoo': 'odoo:latest', 'web': 'web:latest'}},
                      {'compatibilityEvidence': {}}, {'releaseId': '../secret'}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_manifest(release(**patch))

    def test_rejects_unknown_fields_and_duplicate_json_keys(self):
        with self.assertRaises(ValueError):
            validate_manifest(release(password='secret'))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.json'
            path.write_text('{"releaseId":"a","releaseId":"b"}')
            with self.assertRaises(ValueError):
                load_manifest(path)

    def classify(self, before, after, manifest=None, **options):
        with tempfile.TemporaryDirectory() as directory:
            base, target = Path(directory) / 'base', Path(directory) / 'target'
            for root, contents in ((base, before), (target, after)):
                root.mkdir()
                for name, content in contents.items():
                    path = root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(content)
            return classify_release(base, target, manifest or release(), **options)

    def test_reviewed_css_is_online(self):
        result = self.classify({'apps/web/app/a.css': 'a{}'}, {'apps/web/app/a.css': 'b{}'})
        self.assertTrue(result['eligible'])
        self.assertEqual(result['mode'], 'online')

    def test_unknown_change_is_blocked(self):
        result = self.classify({}, {'startup.sh': 'run anything'})
        self.assertFalse(result['eligible'])
        self.assertIn('unknown_change', result['reasons'])

    def test_reviewed_python_requires_explicit_semantic_evidence(self):
        before = {'odoo-addons/liwan_a/__manifest__.py': "{'version':'19.0.1.0.0','depends':[]}",
                  'odoo-addons/liwan_a/models/a.py': 'def value(): return 1'}
        after = dict(before, **{'odoo-addons/liwan_a/models/a.py': 'def value(): return 2'})
        manifest = release(moduleVersions={'liwan_a': '19.0.1.0.0'}, affectedServices=['odoo'])
        self.assertFalse(self.classify(before, after, manifest)['eligible'])
        manifest['compatibilityEvidence']['reviewedPaths'] = ['odoo-addons/liwan_a/models/a.py']
        self.assertTrue(self.classify(before, after, manifest)['eligible'])

    def test_schema_security_data_and_dependencies_cannot_claim_online(self):
        before = {'odoo-addons/liwan_a/__manifest__.py': "{'version':'19.0.1.0.0','depends':[]}",
                  'odoo-addons/liwan_a/models/a.py': 'value = 1'}
        for name, content in (
            ('models/a.py', "name = fields.Char()"),
            ('security/ir.model.access.csv', 'access'), ('data/a.xml', '<odoo/>'),
            ('__manifest__.py', "{'version':'19.0.1.0.0','depends':['base']}")):
            after = dict(before, **{'odoo-addons/liwan_a/' + name: content})
            self.assertFalse(self.classify(before, after)['eligible'])

    def test_dependency_and_reverse_dependency_closure(self):
        before = {}
        for module, dependencies in [('base', []), ('liwan_a', ['base']), ('liwan_bridge', ['liwan_a'])]:
            before[f'odoo-addons/{module}/__manifest__.py'] = repr({'version': '19.0.1.0.0', 'depends': dependencies})
        after = dict(before, **{'odoo-addons/liwan_a/data/a.xml': '<odoo/>'})
        value = release(mode='tenant_maintenance', upgradeModules=['liwan_a'],
                        moduleVersions={key: '19.0.1.0.0' for key in ('base', 'liwan_a', 'liwan_bridge')},
                        affectedServices=['odoo'])
        result = self.classify(before, after, value)
        self.assertTrue(result['eligible'])
        self.assertEqual(result['affected_modules'], ['base', 'liwan_a', 'liwan_bridge'])

    def test_reviewed_sql_and_model_security_changes_still_require_maintenance(self):
        prefix = 'odoo-addons/liwan_a/'
        before = {prefix + '__manifest__.py': "{'version':'19.0.1.0.0','depends':[]}",
                  prefix + 'models/a.py': 'def work(): return 1'}
        for code in ("def work(): env.cr.execute('ALTER TABLE x ADD y INTEGER')",
                     "def check_access(self): return True"):
            after = dict(before, **{prefix + 'models/a.py': code})
            value = release(moduleVersions={'liwan_a': '19.0.1.0.0'}, affectedServices=['odoo'])
            value['compatibilityEvidence']['reviewedPaths'] = [prefix + 'models/a.py']
            self.assertFalse(self.classify(before, after, value)['eligible'])

    def test_manifest_versions_cover_every_declared_module(self):
        with self.assertRaises(ValueError):
            validate_manifest(release(mode='tenant_maintenance', upgradeModules=['liwan_a']))

    def test_stock_odoo_versions_match_the_canonical_installed_version(self):
        files = {'odoo/addons/base/__manifest__.py': "{'version':'1.3','depends':[]}",
                 'odoo-addons/liwan_a/__manifest__.py': "{'version':'19.0.1.0.0','depends':['base']}"}
        after = dict(files, **{'odoo-addons/liwan_a/data/a.xml': '<odoo/>'})
        value = release(mode='tenant_maintenance', upgradeModules=['liwan_a'],
                        moduleVersions={'base': '19.0.1.3', 'liwan_a': '19.0.1.0.0'})
        self.assertTrue(self.classify(files, after, value)['eligible'])

    def stock_inventory(self):
        modules = {'base': ('1.3', []), 'mail': ('1.19', ['base']),
                   'project': ('1.4', ['mail']), 'sale': ('1.2', ['mail']),
                   'liwan_bridge': ('19.0.1.0.0', ['project']),
                   'liwan_unused_bridge': ('19.0.1.0.0', ['project'])}
        return {f'addons/{name}/__manifest__.py': repr({'version': version, 'depends': deps})
                for name, (version, deps) in modules.items()}

    def test_stock_reverse_closure_uses_declared_installed_inventory(self):
        before = self.stock_inventory()
        after = dict(before, **{'addons/project/data/project.xml': '<odoo/>'})
        versions = {'base': '19.0.1.3', 'mail': '19.0.1.19', 'project': '19.0.1.4',
                    'liwan_bridge': '19.0.1.0.0'}
        value = release(mode='tenant_maintenance', upgradeModules=['project'], moduleVersions=versions)
        result = self.classify(before, after, value)
        self.assertTrue(result['eligible'], result)
        self.assertEqual(result['affected_modules'], ['base', 'mail', 'project', 'liwan_bridge'])

    def test_explicit_installed_scope_overrides_inventory_but_includes_requested_installs(self):
        before = self.stock_inventory()
        after = dict(before, **{'addons/project/data/project.xml': '<odoo/>'})
        versions = {'base': '19.0.1.3', 'mail': '19.0.1.19', 'project': '19.0.1.4',
                    'sale': '19.0.1.2', 'liwan_bridge': '19.0.1.0.0'}
        value = release(mode='tenant_maintenance', upgradeModules=['project'],
                        installModules=['liwan_bridge'], moduleVersions=versions)
        result = self.classify(before, after, value, installed_modules={'base', 'mail', 'project'})
        self.assertTrue(result['eligible'], result)
        self.assertEqual(result['affected_modules'], ['base', 'mail', 'project', 'liwan_bridge'])

    def test_forward_dependencies_are_not_limited_to_installed_scope(self):
        before = self.stock_inventory()
        value = release(mode='tenant_maintenance', installModules=['project'],
                        moduleVersions={'base': '19.0.1.3', 'mail': '19.0.1.19', 'project': '19.0.1.4'})
        result = self.classify(before, before, value, installed_modules=set())
        self.assertTrue(result['eligible'], result)
        self.assertEqual(result['affected_modules'], ['base', 'mail', 'project'])

    def test_installed_scope_rejects_ambiguous_or_unsafe_values(self):
        for scope in ('project', {'../project'}, {'project': True}, [1]):
            with self.subTest(scope=scope), self.assertRaisesRegex(ValueError, '^installed_modules_rejected$'):
                self.classify({}, {}, installed_modules=scope)

    def test_stock_version_defaults_and_three_part_raw_versions(self):
        for raw, canonical in ((None, '19.0.1.0'), ('1.2.3', '19.0.1.2.3'),
                               ('1.3', '19.0.1.3'), ('19.0.2.1', '19.0.2.1')):
            with self.subTest(raw=raw):
                addon = {'depends': []}
                if raw is not None:
                    addon['version'] = raw
                files = {'addons/base/__manifest__.py': repr(addon)}
                value = release(mode='tenant_maintenance', upgradeModules=['base'],
                                moduleVersions={'base': canonical})
                self.assertTrue(self.classify(files, files, value)['eligible'])

    def test_incompatible_stock_version_blocks_source_inspection(self):
        files = {'addons/base/__manifest__.py': "{'version':'18.0.1.0','depends':[]}"}
        value = release(mode='tenant_maintenance', upgradeModules=['base'], moduleVersions={'base': '19.0.1.0'})
        self.assertEqual(self.classify(files, files, value)['reasons'], ['source_inspection_failed'])

    def test_worktree_git_metadata_is_not_a_release_change(self):
        self.assertTrue(self.classify({'.git': 'gitdir: before'}, {'.git': 'gitdir: after'})['eligible'])

    def test_missing_dependency_and_wrong_version_block_release(self):
        contents = {'odoo-addons/liwan_a/__manifest__.py': "{'version':'19.0.2.0.0','depends':['missing']}"}
        value = release(mode='tenant_maintenance', installModules=['liwan_a'], moduleVersions={'liwan_a': '19.0.1.0.0'})
        result = self.classify({}, contents, value)
        self.assertFalse(result['eligible'])
        self.assertIn('unresolved_dependency', result['reasons'])
        self.assertIn('module_version_mismatch', result['reasons'])


if __name__ == '__main__':
    unittest.main()
