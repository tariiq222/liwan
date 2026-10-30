"""Actual operator files and rendered Compose contract; no Docker services."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from .helper_runtime import verify_helper_runtime

IMAGE = 'liwan/odoo@sha256:' + 'a' * 64


def helper_fixture(root):
    root = Path(root)
    compose, env, odoo = root / 'compose.yml', root / 'runtime.env', root / 'odoo.conf'
    compose.write_text('services:\n  odoo:\n    image: pinned-by-render-test\n')
    env.write_text('SYNTHETIC_HELPER_SECRET=secret-not-for-output\n')
    odoo.write_text('[options]\ndb_user = blue_role\ndb_password = SYNTHETIC_HELPER_SECRET\n')
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    config = {'projectName': 'liwan-shared-blue', 'composeFile': str(compose), 'envFile': str(env)}
    metadata = {**config, 'composeSha256': digest(compose), 'envSha256': digest(env),
                'odooImage': IMAGE, 'odooConfig': str(odoo), 'odooConfigSha256': digest(odoo), 'dbUser': 'blue_role'}
    pools = {'schemaVersion': 1, 'pools': {'blue': {'poolId': 'blue', 'releaseId': 'release_blue','images':{'odoo':IMAGE},'dbUser':'blue_role', 'helperConfig': metadata}}}
    (root / 'pools.json').write_text(json.dumps(pools))
    rendered = {'services': {'odoo': {'image': IMAGE, 'volumes': [
        {'type': 'bind', 'source': str(odoo), 'target': '/etc/odoo/odoo.conf', 'read_only': True}]}}}
    return config, metadata, pools, rendered


class HelperRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.config, self.metadata, self.pools, self.rendered = helper_fixture(self.root)
        self.lease = {'tenantId': 'tenant_a', 'operation': 'observe', 'poolId': 'blue', 'routeRevision': 2, 'fence': 8}
        self.env = patch.dict(os.environ, {'LIWAN_RELEASE_ROUTES_DIR': str(self.root)})
        self.env.start(); self.addCleanup(self.env.stop)

    def runner(self, argv, **kwargs):
        self.assertEqual(argv, ['docker', 'compose', '--project-name', 'liwan-shared-blue', '--env-file', self.config['envFile'], '--file', self.config['composeFile'], 'config', '--format', 'json'])
        self.assertFalse(kwargs['shell']); self.assertEqual(kwargs['timeout'], 30)
        return subprocess.CompletedProcess(argv, 0, json.dumps(self.rendered), 'ignored synthetic diagnostic')

    def verify(self):
        return verify_helper_runtime(self.config, self.lease, 'blue', runner=self.runner)

    def test_real_operator_files_and_rendered_pinned_mount_role_are_verified(self):
        result = self.verify()
        self.assertTrue(result['verified'])
        self.assertEqual(result['odooImage'], IMAGE)
        self.assertNotIn('SYNTHETIC_HELPER_SECRET', str(result))

    def test_wrong_project_compose_and_env_are_rejected(self):
        for key in ('projectName', 'composeFile', 'envFile'):
            config = {**self.config, key: 'wrong'}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, '^helper_runtime_rejected$'):
                verify_helper_runtime(config, self.lease, 'blue', runner=self.runner)

    def test_unpinned_or_mismatched_rendered_image_is_rejected(self):
        for image in ('liwan/odoo:latest', 'liwan/odoo@sha256:' + 'b' * 64):
            self.rendered['services']['odoo']['image'] = image
            with self.subTest(image=image), self.assertRaises(ValueError): self.verify()

    def test_wrong_writable_or_missing_config_mount_is_rejected(self):
        mount = self.rendered['services']['odoo']['volumes'][0]
        for update in ({'source': str(self.root / 'other.conf')}, {'read_only': False}, {'type': 'volume'}):
            self.rendered['services']['odoo']['volumes'] = [{**mount, **update}]
            with self.subTest(patch=update), self.assertRaises(ValueError): self.verify()
        self.rendered['services']['odoo']['volumes'] = []
        with self.assertRaises(ValueError): self.verify()

    def test_file_digest_and_actual_db_role_must_both_match(self):
        Path(self.config['envFile']).write_text('changed')
        with self.assertRaises(ValueError): self.verify()
        self.config, self.metadata, self.pools, self.rendered = helper_fixture(self.root)
        path = Path(self.metadata['odooConfig']); path.write_text('[options]\ndb_user=foreign_role\n')
        self.metadata['odooConfigSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        (self.root / 'pools.json').write_text(json.dumps(self.pools))
        with self.assertRaises(ValueError): self.verify()

    def test_pending_provision_still_needs_complete_pool_metadata(self):
        self.lease = {**self.lease, 'operation': 'provision', 'poolId': 'pending', 'routeRevision': 0, 'fence': 0}
        self.assertTrue(self.verify()['verified'])
        del self.pools['pools']['blue']['helperConfig']
        (self.root / 'pools.json').write_text(json.dumps(self.pools))
        with self.assertRaises(ValueError): self.verify()

    def test_process_failure_and_config_symlink_never_disclose_rendered_secrets(self):
        def failed(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 1, 'SYNTHETIC_HELPER_SECRET', 'SYNTHETIC_HELPER_SECRET')
        with self.assertRaisesRegex(ValueError, '^helper_runtime_rejected$'):
            verify_helper_runtime(self.config, self.lease, 'blue', runner=failed)
        original = Path(self.metadata['odooConfig']); target = self.root / 'link.conf'; target.symlink_to(original)
        self.metadata['odooConfig'] = str(target)
        (self.root / 'pools.json').write_text(json.dumps(self.pools))
        with self.assertRaises(ValueError): self.verify()


if __name__ == '__main__': unittest.main()
