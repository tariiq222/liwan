# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""No Docker/database operations: validate frozen input and provisioning command wiring."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path

import classification

ROOT = Path(__file__).resolve().parents[1]


class TestClassification(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'input.json'
        self.output = self.root / 'snapshot.json'
        self.data = {
            'schema_version': 1, 'database': 'nasq_test_scratch',
            'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }

    def stage(self, **updates):
        self.source.write_text(json.dumps({**self.data, **updates}))
        classification.stage(self.source, self.output, self.data['database'], None, fresh=True)

    def test_snapshot_is_validated_readonly_and_does_not_follow_later_source_edits(self):
        self.stage()
        saved = self.output.read_bytes()
        self.source.write_text('{}')
        self.assertEqual(self.output.read_bytes(), saved)
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o444)
        with self.assertRaises(FileExistsError):
            self.stage()

    def test_wrong_database_pairs_and_fresh_clear_leave_no_output(self):
        for update in ({'database': 'other'}, {'entitlement_source': 'control_plane'},
                       {'valid_until_action': 'clear'}, {'commercial_mode': 'guess'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.stage(**update)
            self.assertFalse(self.output.exists())

    def test_upgrade_cutoff_must_match_and_explicit_clear_is_required(self):
        self.data.update(expected_valid_until='2026-01-01', valid_until_action='clear')
        self.source.write_text(json.dumps(self.data))
        with self.assertRaises(ValueError):
            classification.stage(self.source, self.output, self.data['database'], date(2026, 1, 2))
        classification.stage(self.source, self.output, self.data['database'], date(2026, 1, 1))
        self.assertTrue(self.output.exists())

    def test_fixture_is_explicit_scratch_only_and_never_overwrites(self):
        for db in ('customer', 'odoo19', 'nasq_production_scratch'):
            with self.assertRaises(ValueError):
                classification.fixture(db, 'saas', self.output)
        classification.fixture('nasq_test_scratch', 'saas', self.output)
        self.assertEqual(json.loads(self.output.read_text())['entitlement_source'], 'control_plane')
        with self.assertRaises(FileExistsError):
            classification.fixture('nasq_test_scratch', 'non_saas', self.output)

    def test_missing_and_invalid_json_are_fail_closed(self):
        with self.assertRaises(FileNotFoundError):
            classification.stage(self.source, self.output, self.data['database'], None)
        for raw in (b'bad', b'{"database":"a","database":"b"}', b'x' * 16385):
            self.source.write_bytes(raw)
            with self.assertRaises(ValueError):
                classification.stage(self.source, self.output, self.data['database'], None)
            self.assertFalse(self.output.exists())

    def provision_fixture(self):
        deploy = self.root / 'deploy'
        deploy.mkdir()
        for name in ('provision.sh', 'classification.py', 'seed_branding.py', 'seed_legacy_policy.py'):
            shutil.copy(ROOT / 'deploy' / name, deploy / name)
        config = self.root / 'odoo-addons/nasq_platform'
        config.mkdir(parents=True)
        shutil.copy(classification.PARSER, config / 'commercial_config.py')
        (deploy / 'odoo').mkdir()
        (deploy / 'odoo/ODOO_COMMIT').write_text('test-pin')
        (deploy / 'odoo.conf').write_text('[options]\n')
        (deploy / 'branding.json').write_text('{}')
        self.source.write_text(json.dumps(self.data))
        (deploy / '.env').write_text(
            'DB_PASSWORD=long-test-only-password\nODOO_ADMIN_PASSWORD=long-test-only-password\n'
            'VENDOR_PASSWORD=long-test-only-password\n',
        )
        binpath = self.root / 'bin'
        binpath.mkdir()
        docker = binpath / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
record = {'args': args}
if 'docker-compose.classification.yml' in args:
    path = pathlib.Path(os.environ['NASQ_CLASSIFICATION_FILE'])
    record['snapshot'] = json.loads(path.read_text())
    record['path'] = str(path)
with open(os.environ['DOCKER_LOG'], 'a') as f:
    f.write(json.dumps(record) + '\\n')
''')
        docker.chmod(0o755)
        envsubst = binpath / 'envsubst'
        envsubst.write_text('#!/bin/sh\nexec cat\n')
        envsubst.chmod(0o755)
        env = {**os.environ, 'PATH': str(binpath) + os.pathsep + os.environ['PATH'],
               'NASQ_COMMERCIAL_CONFIG': str(self.source), 'NASQ_IMAGE_TAG': 'test-only',
               'DOCKER_LOG': str(self.root / 'docker.log')}
        return deploy, env

    def test_provision_validates_before_docker_and_mounts_only_during_install(self):
        deploy, env = self.provision_fixture()
        result = subprocess.run(['bash', str(deploy / 'provision.sh'), 'test.invalid', self.data['database']],
                                env=env, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(line) for line in (self.root / 'docker.log').read_text().splitlines()]
        classified = [record for record in records if 'snapshot' in record]
        self.assertEqual(len(classified), 1)
        self.assertEqual(classified[0]['snapshot'], self.data)
        self.assertIn('-i', classified[0]['args'])
        self.assertFalse(Path(classified[0]['path']).exists())
        self.assertEqual(records[-1]['args'], ['compose', 'up', '-d'])

    def test_invalid_provision_never_calls_docker(self):
        deploy, env = self.provision_fixture()
        self.source.write_text('{}')
        result = subprocess.run(['bash', str(deploy / 'provision.sh'), 'test.invalid', self.data['database']],
                                env=env, text=True, capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'docker.log').exists())

    def test_compose_overlay_is_readonly_opt_in_and_ci_targets_are_explicit(self):
        base = (ROOT / 'deploy/docker-compose.yml').read_text()
        overlay = (ROOT / 'deploy/docker-compose.classification.yml').read_text()
        self.assertNotIn('NASQ_COMMERCIAL_CONFIG', base)
        for text in ('read_only: true', 'create_host_path: false', '/run/nasq/classification.json', '${NASQ_CLASSIFICATION_FILE:?'):
            self.assertIn(text, overlay)
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        for db, mode in (('"nasq_ci_scratch_${{ github.run_id }}"', 'saas'),
                         ('nasq_ci_upgrade_scratch', 'saas'), ('nasq_image_scratch', 'non_saas'),
                         ('nasq_drill_src_scratch', 'non_saas')):
            self.assertIn(f'fixture --database {db} --mode {mode}', workflow)
        self.assertNotIn('NASQ_COMMERCIAL_CONFIG=$RUNNER_TEMP/upgrade-classification.json', workflow)
        upgrade = workflow.split('Upgrade to this commit', 1)[1].split('Post-upgrade smoke', 1)[0]
        previous = workflow.split('Install the previous release', 1)[1].split('Upgrade to this commit', 1)[0]
        self.assertIn('NASQ_COMMERCIAL_CONFIG: ${{ runner.temp }}/upgrade-classification.json', upgrade)
        self.assertIn('previous release must not inherit a commercial classification', previous)
        self.assertIn('-e NASQ_COMMERCIAL_CONFIG=/run/nasq/classification.json', workflow)
        self.assertIn('image-classification.json:/run/nasq/classification.json:ro', workflow)
        self.assertIn('unset NASQ_COMMERCIAL_CONFIG', workflow)
        self.assertIn('negative case passed unexpectedly', workflow)
        self.assertIn('tools/upgrade_log_guard.py upgrade.log', workflow)


if __name__ == '__main__':
    unittest.main()
