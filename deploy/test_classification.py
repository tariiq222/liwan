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

from deploy import classification

ROOT = Path(__file__).resolve().parents[1]


class TestClassification(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'input.json'
        self.output = self.root / 'snapshot.json'
        self.data = {
            'schema_version': 1, 'database': 'liwan_test_scratch',
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
        for db in ('customer', 'odoo19', 'liwan_production_scratch'):
            with self.assertRaises(ValueError):
                classification.fixture(db, 'saas', self.output)
        classification.fixture('liwan_test_scratch', 'saas', self.output)
        self.assertEqual(json.loads(self.output.read_text())['entitlement_source'], 'control_plane')
        with self.assertRaises(FileExistsError):
            classification.fixture('liwan_test_scratch', 'non_saas', self.output)

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
        for name in ('provision.sh', 'classification.py', 'seed_branding.py', 'seed_legacy_policy.py', 'seed_public_origin.py'):
            shutil.copy(ROOT / 'deploy' / name, deploy / name)
        config = self.root / 'odoo-addons/liwan_platform'
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
    path = pathlib.Path(os.environ['LIWAN_CLASSIFICATION_FILE'])
    record['snapshot'] = json.loads(path.read_text())
    record['path'] = str(path)
if 'psql' in args or 'shell' in args:
    record['stdin'] = sys.stdin.read()
    record['domain'] = os.environ.get('DOMAIN')
with open(os.environ['DOCKER_LOG'], 'a') as f:
    f.write(json.dumps(record) + '\\n')
''')
        docker.chmod(0o755)
        envsubst = binpath / 'envsubst'
        envsubst.write_text('#!/bin/sh\nexec cat\n')
        envsubst.chmod(0o755)
        env = {**os.environ, 'PATH': str(binpath) + os.pathsep + os.environ['PATH'],
               'LIWAN_COMMERCIAL_CONFIG': str(self.source), 'LIWAN_IMAGE_TAG': 'test-only',
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

    def psql_records(self):
        records = [json.loads(line) for line in (self.root / 'docker.log').read_text().splitlines()]
        return [record for record in records if 'psql' in record['args']]

    def test_provision_closes_tenant_database_to_ai_role_before_serving(self):
        deploy, env = self.provision_fixture()
        result = subprocess.run(['bash', str(deploy / 'provision.sh'), 'test.invalid', self.data['database']],
                                env=env, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(line) for line in (self.root / 'docker.log').read_text().splitlines()]
        revokes = [index for index, record in enumerate(records) if 'psql' in record['args']]
        self.assertEqual(len(revokes), 1)
        self.assertLess(max(i for i, r in enumerate(records) if 'snapshot' in r), revokes[0])
        self.assertLess(revokes[0], len(records) - 1)
        record = records[revokes[0]]
        self.assertIn(f'tenant_db={self.data["database"]}', record['args'])
        self.assertIn('ON_ERROR_STOP=1', record['args'])
        sql = record['stdin']
        self.assertIn("rolname = 'liwan_ai'", sql)
        self.assertIn('FROM PUBLIC', sql)
        self.assertIn('FROM liwan_ai', sql)
        self.assertNotIn(self.data['database'], sql)

    def origin_records(self):
        records = [json.loads(line) for line in (self.root / 'docker.log').read_text().splitlines()]
        return records, [index for index, record in enumerate(records)
                         if '_liwan_set_public_origin' in record.get('stdin', '')]

    def test_provision_pins_the_public_origin_before_serving(self):
        deploy, env = self.provision_fixture()
        result = subprocess.run(['bash', str(deploy / 'provision.sh'), 'test.invalid', self.data['database']],
                                env=env, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        records, pinned = self.origin_records()
        self.assertEqual(len(pinned), 1)
        record = records[pinned[0]]
        self.assertEqual(record['domain'], 'test.invalid')
        self.assertIn('DOMAIN', record['args'][record['args'].index('-e') + 1])
        self.assertLess(max(i for i, r in enumerate(records) if 'snapshot' in r), pinned[0])
        self.assertEqual(records[-1]['args'], ['compose', 'up', '-d'])

    def test_a_domain_change_repins_only_the_public_origin(self):
        deploy, env = self.provision_fixture()
        (deploy / 'data').mkdir()
        (deploy / 'data/odoo.conf').write_text('[options]\n')
        result = subprocess.run(['bash', str(deploy / 'provision.sh'), '--public-origin', 'erp.customer.sa', self.data['database']],
                                env=env, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        records, pinned = self.origin_records()
        self.assertEqual(pinned, [0])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['domain'], 'erp.customer.sa')
        self.assertIn(self.data['database'], records[0]['args'])

    def test_a_domain_that_is_not_a_lowercase_dns_name_never_calls_docker(self):
        deploy, env = self.provision_fixture()
        for domain in ('localhost', 'App.customer.sa', 'app.customer.sa.', 'app.customer.sa:8443'):
            with self.subTest(domain=domain):
                result = subprocess.run(['bash', str(deploy / 'provision.sh'), domain, self.data['database']],
                                        env=env, text=True, capture_output=True, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('domain', result.stderr)
        self.assertFalse((self.root / 'docker.log').exists())

    def test_a_domain_change_needs_a_provisioned_environment(self):
        deploy, env = self.provision_fixture()
        result = subprocess.run(['bash', str(deploy / 'provision.sh'), '--public-origin', 'erp.customer.sa', self.data['database']],
                                env=env, text=True, capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('provision', result.stderr)
        self.assertFalse((self.root / 'docker.log').exists())

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
        self.assertNotIn('LIWAN_COMMERCIAL_CONFIG', base)
        for text in ('read_only: true', 'create_host_path: false', '/run/liwan/classification.json', '${LIWAN_CLASSIFICATION_FILE:?'):
            self.assertIn(text, overlay)
        # CI is the GitHub Actions workflow running deploy/ci/<stage>.sh. The same
        # provisioning invariants must hold in the stage scripts.
        pipeline = ''.join((ROOT / 'deploy' / 'ci' / (stage + '.sh')).read_text()
                           for stage in ('odoo', 'upgrade', 'restore-drill', 'image'))
        # The stage scripts use shell variables for DB names; verify
        # the fixture invocations are present with the expected modes.
        self.assertIn('fixture --database "$SCRATCH_DB" --mode saas', pipeline)
        self.assertIn('fixture --database "$SCRATCH_DB" --mode non_saas', pipeline)
        self.assertIn('fixture --database "$SRC_DB" --mode non_saas', pipeline)
        # The previous-release install never inherits a classification from the
        # environment: it gets its own explicit fixture, and only the upgrade step
        # points at the upgrade fixture.
        previous = pipeline.split('# Install the previous release', 1)[1].split('# Upgrade to this commit', 1)[0]
        upgrade = pipeline.split('# Upgrade to this commit', 1)[1].split('# Post-upgrade smoke', 1)[0]
        self.assertIn('previous release must not inherit a commercial classification', previous)
        self.assertIn('LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/baseline-classification.json"', previous)
        self.assertNotIn('upgrade-classification.json', previous)
        self.assertIn('LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/upgrade-classification.json"', upgrade)
        self.assertIn('-e LIWAN_COMMERCIAL_CONFIG=/run/liwan/classification.json', pipeline)
        self.assertIn('classification.json:/run/liwan/classification.json:ro', pipeline)
        self.assertIn('unset LIWAN_COMMERCIAL_CONFIG', pipeline)
        self.assertIn('negative case passed unexpectedly', pipeline)
        self.assertIn('tools/upgrade_log_guard.py', pipeline)


if __name__ == '__main__':
    unittest.main()
