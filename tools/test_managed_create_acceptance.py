# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Managed-create acceptance contracts; doubles never invoke Docker or a database."""
import hashlib
import json
import sys
from pathlib import Path
from unittest.mock import patch

from webvue_cli.managed_runtime import OUTPUT_LIMIT, _subprocess, managed_adapter
from test_managed_runtime import FakeProbe, ManagedRuntimeCase, RecordingRunner


class ManagedCreatePolicyCase(ManagedRuntimeCase):
    def setUp(self):
        super().setUp()
        self.catalog_source = Path(__file__).resolve().parents[1] / 'deploy/catalog/solutions/platform.json'
        self.catalog_sha = 'sha256:' + hashlib.sha256(self.catalog_source.read_bytes()).hexdigest()
        self.policy_value = {
            'schema_version': 1, 'channel': 'control_plane',
            'modules': ['webvue_core', 'webvue_platform', 'webvue_api', 'webvue_hr'],
            'features': {'users.limit': None, 'storage.limit_mb': None, 'hr.enabled': True},
        }
        self.policy.write_text(json.dumps(self.policy_value))
        self.base = self.rewrite(release_ref={'catalog_sha256': self.catalog_sha})

    def test_invalid_policy_is_refused_without_effect_or_journal(self):
        self.policy.write_bytes(b'{"policy":"same"}')
        self.refuse(2, 'policy_invalid')
        self.assertEqual(self.journal_rows(), [])

    def test_policy_channel_cannot_disagree_with_saas_descriptor(self):
        self.policy_value['channel'] = 'local_policy'
        self.policy.write_text(json.dumps(self.policy_value))
        self.refuse(2, 'policy_channel_mismatch')
        self.assertEqual(self.journal_rows(), [])

    def test_catalog_identity_is_checked_before_mutation(self):
        self.rewrite(release_ref={'catalog_sha256': 'sha256:' + '0' * 64})
        self.refuse(2, 'catalog_digest_mismatch')
        self.assertEqual(self.journal_rows(), [])

    def test_people_tier_installs_no_unselected_webvue_pillars(self):
        runner = RecordingRunner()
        self.adapter(self.fields(), runner=runner)
        install_commands = [args for args, _, _ in runner.calls if '-i' in args]
        self.assertEqual(len(install_commands), 1)
        args = install_commands[0]
        self.assertEqual(args[args.index('-i') + 1], ','.join(self.policy_value['modules']))

    def snapshot(self):
        return 'WEBVUE_MANAGED_POLICY:' + json.dumps({
            'database': self.base['resource_refs']['db_name'],
            'commercial_mode': 'saas', 'entitlement_source': 'control_plane',
            'status': 'active', 'valid_until': None,
            'features': self.policy_value['features'], 'policy_revision': 1,
            'modules': ['base', 'project', 'hr', 'webvue_access_hr'] + self.policy_value['modules'],
        }) + '\n'

    def credential_snapshot(self, changed):
        return 'WEBVUE_MANAGED_CREDENTIALS:' + json.dumps({
            'database': self.base['resource_refs']['db_name'],
            'changed': changed, 'verified': True,
        }) + '\n'

    def successful_runner(self):
        return RecordingRunner(results=[
            (0, '', ''),  # start new db
            (0, '', ''),  # readiness
            (0, '', ''),  # install
            (0, self.snapshot(), ''),  # apply transaction
            (0, self.snapshot(), ''),  # independent readback
            (0, self.credential_snapshot(True), ''),  # initialize human admin
            (0, self.credential_snapshot(False), ''),  # independent credential readback
            (0, '', ''),  # start services
        ])

    def test_readiness_failure_never_starts_install(self):
        runner = RecordingRunner(default=(1, '', ''))
        code, payload = self.adapter(self.fields(), runner=runner)
        self.assertEqual(code, 6, payload)
        self.assertFalse(any('-i' in args for args, _, _ in runner.calls))

    def test_independent_readback_and_http_are_required_before_ready(self):
        runner = self.successful_runner()
        with patch('webvue_cli.managed_runtime._http_health', return_value=True, create=True) as health:
            code, payload = self.adapter(self.fields(), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertIs(payload['policy_verified'], True)
        self.assertIs(payload['deployment_ready'], True)
        self.assertEqual(payload['profile']['features'], self.policy_value['features'])
        shell_calls = [args for args, _, _ in runner.calls if 'shell' in args]
        self.assertEqual(len(shell_calls), 4)
        credential_calls = [args for args in shell_calls if 'WEBVUE_ADMIN_PASSWORD' in args]
        self.assertEqual(len(credential_calls), 2)
        for args in credential_calls:
            self.assertLess(args.index('WEBVUE_ADMIN_PASSWORD'), args.index('odoo'))
        self.assertEqual(health.call_count, 1)
        readiness = next(args for args, _, _ in runner.calls if 'pg_isready' in args)
        self.assertIn('-h', readiness)
        self.assertEqual(readiness[readiness.index('-h') + 1], '127.0.0.1')

    def test_missing_credential_readback_never_exposes_services(self):
        runner = self.successful_runner()
        runner.results[6] = (0, '', '')
        code, payload = self.adapter(self.fields(), runner=runner)
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['stage'], 'credential_readback')
        self.assertEqual(len(runner.calls), 7)
        self.assertFalse(any('up' in args and 'edge' in args for args, _, _ in runner.calls))

    def test_default_docker_endpoint_is_local_and_replay_skips_context_resolution(self):
        runner = self.successful_runner()
        with patch('webvue_cli.managed_runtime.local_docker_runner', return_value=runner) as factory, \
                patch('webvue_cli.managed_runtime._http_health', return_value=True):
            code, receipt = managed_adapter(self.fields(), probe=self.probe(), resolver=self.resolver())
            self.assertEqual(code, 0, receipt)
            self.assertEqual(factory.call_count, 1)
            code, replay = managed_adapter(self.fields(), probe=self.probe(), resolver=self.resolver())
            self.assertEqual(code, 0, replay)
            self.assertEqual(factory.call_count, 1)
            self.assertEqual(receipt['operation_id'], replay['operation_id'])

    def test_http_failure_quarantines_after_successful_policy_readback(self):
        with patch('webvue_cli.managed_runtime._http_health', return_value=False, create=True):
            code, payload = self.adapter(self.fields(), runner=self.successful_runner())
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['lifecycle'], 'quarantined')
        self.assertIsNot(payload.get('deployment_ready'), True)

    def test_default_probe_is_descriptor_bound_and_fails_closed(self):
        # When the probe cannot verify image identity (e.g. Docker unavailable),
        # the adapter must refuse at preflight without reaching provisioning.
        # Use a probe that raises ProbeError for image_identity to simulate
        # this; the real probe depends on host Docker availability.
        from webvue_cli import managed_probe
        class ImageRefusingProbe(FakeProbe):
            def __call__(self, check, value=None):
                if check == 'image_identity':
                    raise managed_probe.ProbeError('preflight_unavailable')
                return super().__call__(check, value)
        runner = RecordingRunner(default=(1, '', ''))
        code, payload = managed_adapter(
            self.fields(), runner=runner,
            probe=ImageRefusingProbe(self.world()),
            resolver=self.resolver())
        self.assertEqual(code, 4, payload)
        self.assertEqual(payload['error']['code'], 'preflight_unavailable')

    def test_durable_status_preserves_verified_creation_evidence(self):
        with patch('webvue_cli.managed_runtime._http_health', return_value=True, create=True):
            code, created = self.adapter(self.fields(), runner=self.successful_runner())
        self.assertEqual(code, 0, created)
        fields = self.fields('status')
        fields['request_id'] = self.fields()['request_id']
        fields.pop('policy_file', None)
        fields['policy_bytes_file'] = str(self.policy)
        code, durable = self.adapter(fields)
        self.assertEqual(code, 0, durable)
        self.assertIs(durable['policy_verified'], True)
        self.assertIs(durable['deployment_ready'], True)
        self.assertEqual(durable['profile'], created['profile'])

    def test_oversized_process_output_cannot_be_trusted_as_complete_observation(self):
        code, output, _ = _subprocess([sys.executable, '-c', f'print("x" * {OUTPUT_LIMIT + 1})'])
        self.assertNotEqual(code, 0)
        self.assertEqual(output, '')

    def test_empty_runner_output_cannot_prove_policy_or_health(self):
        code, payload = self.adapter(self.fields(), runner=RecordingRunner(default=(0, '', '')))
        self.assertEqual(code, 6, payload)
        self.assertEqual(payload['status'], 'needs_intervention')
        self.assertIsNot(payload.get('deployment_ready'), True)
        self.assertIsNot(payload.get('policy_verified'), True)
