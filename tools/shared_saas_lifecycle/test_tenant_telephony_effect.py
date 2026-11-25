# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Isolated checks of the tenant telephony effect: a temporary state directory, no docker and no network."""
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from tools.shared_saas_lifecycle import tenant_telephony_effect as effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError

REQUEST_ID = '687674dc-5789-4a99-b151-12d69f010cc3'
ALLOCATION = {'host': 'acme.example.test', 'sipPort': 5060, 'rtpStart': 40100, 'rtpEnd': 40200}


def allocation(**over):
    return {**ALLOCATION, **over}


def request(operation='ensure', tenant_id='acme', **over):
    body = {'schemaVersion': 1, 'operation': operation, 'tenantId': tenant_id, 'requestId': REQUEST_ID,
            'config': {'stateDir': over.pop('stateDir')}}
    if operation == 'ensure' and 'allocation' not in over:
        body['allocation'] = ALLOCATION
    return {**body, **over}


class Case(unittest.TestCase):
    def setUp(self):
        self.state_dir = os.path.realpath(tempfile.mkdtemp(prefix='liwan-telephony-test-'))
        self.addCleanup(self.remove, self.state_dir)

    @staticmethod
    def remove(path):
        for entry in os.scandir(path):
            if entry.is_dir(follow_symlinks=False):
                Case.remove(entry.path)
            else:
                os.unlink(entry.path)
        os.rmdir(path)

    def run_op(self, operation, tenant_id='acme', **over):
        return effect.execute(request(operation, tenant_id=tenant_id, stateDir=self.state_dir, **over))

    def code_of(self, operation, tenant_id='acme', **over):
        with self.assertRaises(EffectError) as caught:
            self.run_op(operation, tenant_id=tenant_id, **over)
        return str(caught.exception)

    def path(self, tenant_id='acme', suffix='.json'):
        return os.path.join(self.state_dir, effect.STATE_DIRECTORY, tenant_id + suffix)

    def body(self, tenant_id='acme', suffix='.json'):
        with open(self.path(tenant_id, suffix), 'rb') as handle:
            return handle.read()

    def write_body(self, tenant_id, body):
        os.makedirs(os.path.dirname(self.path(tenant_id)), mode=0o700, exist_ok=True)
        with open(self.path(tenant_id), 'wb') as handle:
            handle.write(body if isinstance(body, bytes) else json.dumps(body).encode())


class EnsureAndVerifyTest(Case):
    def test_ensure_records_the_allocation_and_answers_active(self):
        answer = self.run_op('ensure')
        self.assertEqual({'operation': 'ensure', 'tenantId': 'acme', 'requestId': REQUEST_ID,
                          'state': 'active', 'stage': 'verified'}, answer)
        record = json.loads(self.body())
        self.assertEqual('acme', record['tenantId'])
        self.assertEqual(ALLOCATION, {key: record[key] for key in effect.ALLOCATION_KEYS})
        self.assertTrue(record['enabled'])
        self.assertEqual(0o600, os.stat(self.path()).st_mode & 0o777)
        self.assertEqual(0o700, os.stat(os.path.dirname(self.path())).st_mode & 0o777)

    def test_verify_answers_the_record_it_provisioned_without_changing_it(self):
        self.run_op('ensure')
        before = self.body()
        self.assertEqual(('active', 'verified'), (self.run_op('verify')['state'], self.run_op('verify')['stage']))
        self.assertEqual(before, self.body())

    def test_ensure_again_is_idempotent_and_leaves_the_record_alone(self):
        self.run_op('ensure')
        before = self.body()
        for _ in range(2):
            self.assertEqual('active', self.run_op('ensure')['state'])
        self.assertEqual(before, self.body())

    def test_verify_before_any_ensure_is_state_missing(self):
        self.assertEqual('state_missing', self.code_of('verify'))

    def test_another_allocation_for_a_recorded_company_is_never_a_silent_rewrite(self):
        self.run_op('ensure')
        before = self.body()
        self.assertEqual('existing_target_refused', self.code_of('ensure', allocation=allocation(sipPort=5061)))
        self.assertEqual(before, self.body())


class ExistingTargetTest(Case):
    def test_another_company_holding_the_same_host_and_sip_port_is_refused(self):
        self.run_op('ensure', tenant_id='globex', allocation=allocation(host='acme.example.test', rtpStart=41000, rtpEnd=41099))
        self.assertEqual('existing_target_refused', self.code_of('ensure'))
        self.assertFalse(os.path.exists(self.path('acme')))  # never adopts another company's target

    def test_an_overlapping_rtp_block_on_the_same_host_is_refused(self):
        self.run_op('ensure', tenant_id='globex', allocation=allocation(rtpStart=40150, rtpEnd=40250))
        self.assertEqual('existing_target_refused', self.code_of('ensure'))
        self.assertFalse(os.path.exists(self.path('acme')))

    def test_a_record_naming_another_company_is_refused_and_left_as_it_was(self):
        self.run_op('ensure', tenant_id='globex')
        self.write_body('acme', json.loads(self.body('globex')))
        before = self.body('acme')
        self.assertEqual('existing_target_refused', self.code_of('ensure'))
        self.assertEqual(before, self.body('acme'))

    def test_an_unreadable_record_of_the_company_is_refused(self):
        self.write_body('acme', b'{"half":')
        self.assertEqual('existing_target_refused', self.code_of('ensure'))
        self.assertIn('existing_target_refused', effect.ERROR_CODES)


class SuspendAndResumeTest(Case):
    def test_suspend_then_resume_keeps_every_recorded_value(self):
        self.run_op('ensure')
        recorded = {key: json.loads(self.body())[key] for key in effect.ALLOCATION_KEYS}
        answer = self.run_op('suspend')
        self.assertEqual(('suspended', 'suspended'), (answer['state'], answer['stage']))
        self.assertFalse(json.loads(self.body())['enabled'])
        self.assertEqual('suspended', self.run_op('verify')['state'])
        self.assertEqual(recorded, {key: json.loads(self.body())[key] for key in effect.ALLOCATION_KEYS})
        answer = self.run_op('resume')
        self.assertEqual(('active', 'verified'), (answer['state'], answer['stage']))
        self.assertTrue(json.loads(self.body())['enabled'])
        self.assertEqual(recorded, {key: json.loads(self.body())[key] for key in effect.ALLOCATION_KEYS})

    def test_suspending_twice_changes_nothing(self):
        self.run_op('ensure')
        self.run_op('suspend')
        before = self.body()
        self.assertEqual('suspended', self.run_op('suspend')['state'])
        self.assertEqual(before, self.body())

    def test_suspend_without_a_record_is_state_missing(self):
        self.assertEqual('state_missing', self.code_of('suspend'))
        self.assertEqual('state_missing', self.code_of('resume'))


class DropTest(Case):
    def test_drop_removes_the_record_and_writes_the_marker(self):
        self.run_op('ensure')
        answer = self.run_op('drop')
        self.assertEqual(('removed', 'resources_removed'), (answer['state'], answer['stage']))
        self.assertFalse(os.path.exists(self.path()))
        marker = json.loads(self.body(suffix='.dropped'))
        self.assertEqual({'requestId': REQUEST_ID, 'droppedAt': marker['droppedAt']}, marker)
        self.assertEqual('removed', self.run_op('drop')['state'])  # a repeated drop stays safe

    def test_a_finished_drop_blocks_every_later_provisioning_of_that_company(self):
        self.run_op('ensure')
        self.run_op('drop')
        for operation in ('ensure', 'verify', 'suspend', 'resume'):
            self.assertEqual('authority_lost', self.code_of(operation))
        self.assertFalse(os.path.exists(self.path()))

    def test_the_marker_is_the_gate_and_an_operator_re_provision_clears_it(self):
        self.run_op('ensure')
        self.run_op('drop')
        os.unlink(self.path(suffix='.dropped'))
        self.assertEqual('active', self.run_op('ensure')['state'])

    def test_drop_of_a_company_that_never_recorded_still_writes_the_marker(self):
        self.assertEqual('removed', self.run_op('drop')['state'])
        self.assertTrue(os.path.exists(self.path(suffix='.dropped')))


class OtherCompanyTest(Case):
    def test_a_second_company_is_untouched_by_the_first(self):
        self.run_op('ensure')
        self.run_op('suspend')
        acme = self.body('acme')
        self.run_op('ensure', tenant_id='globex', allocation=allocation(host='globex.example.test', sipPort=5080))
        self.assertEqual(acme, self.body('acme'))
        self.assertEqual('active', self.run_op('verify', tenant_id='globex')['state'])
        self.assertEqual('suspended', self.run_op('verify')['state'])
        self.run_op('drop', tenant_id='globex')
        self.assertEqual(acme, self.body('acme'))
        self.assertEqual('suspended', self.run_op('verify')['state'])

    def test_the_dropped_marker_of_one_company_does_not_block_another(self):
        self.run_op('drop', tenant_id='globex')
        self.assertEqual('active', self.run_op('ensure')['state'])
        self.assertFalse(os.path.exists(self.path(suffix='.dropped')))


class LockAndRequestTest(Case):
    def test_a_second_operation_on_the_same_company_is_refused_while_one_runs(self):
        with effect.tenant_lock(self.state_dir, 'acme'):
            self.assertEqual('operation_in_progress', self.code_of('ensure'))
            self.assertEqual('active', self.run_op('ensure', tenant_id='globex')['state'])

    def test_a_link_in_place_of_the_record_is_refused(self):
        self.run_op('ensure', tenant_id='globex')
        os.symlink(self.path('globex'), self.path('acme'))
        self.assertEqual('runtime_path_invalid', self.code_of('ensure'))
        self.assertFalse(os.path.exists(self.path('globex') + '.tmp'))

    def test_a_valid_request_passes_and_a_bad_one_is_request_invalid(self):
        for operation in effect.OPERATIONS:
            body = request(operation, stateDir=self.state_dir)
            self.assertEqual(operation, effect.validate_request(body)['operation'])
        bad = [request('destroy', stateDir=self.state_dir), request(schemaVersion=2, stateDir=self.state_dir),
               request(tenantId='../x', stateDir=self.state_dir), request(requestId='nope', stateDir=self.state_dir),
               {k: v for k, v in request(stateDir=self.state_dir).items() if k != 'allocation'},
               request(allocation=allocation(sipPort=0), stateDir=self.state_dir),
               request(allocation=allocation(rtpStart=40200, rtpEnd=40100), stateDir=self.state_dir),
               request('verify', allocation=ALLOCATION, stateDir=self.state_dir), [], 'x']
        for body in bad:
            with self.assertRaises(EffectError) as caught:
                effect.validate_request(body)
            self.assertEqual('request_invalid', str(caught.exception))

    def test_main_prints_one_line_and_reports_a_refusal_as_a_code(self):
        out = io.StringIO()
        self.assertEqual(0, effect.main(io.StringIO(json.dumps(request(stateDir=self.state_dir)) + '\n'), out))
        self.assertEqual('active', json.loads(out.getvalue())['result']['state'])
        out = io.StringIO()
        self.assertEqual(0, effect.main(io.StringIO(json.dumps(request('drop', stateDir=self.state_dir)) + '\n'), out))
        out = io.StringIO()
        self.assertEqual(1, effect.main(io.StringIO(json.dumps(request(stateDir=self.state_dir)) + '\n'), out))
        self.assertEqual({'error_code': 'authority_lost'}, json.loads(out.getvalue()))
        out = io.StringIO()
        raw = 'x' * (effect.MAX_OUTPUT + 2)
        self.assertEqual(1, effect.main(io.StringIO(raw + '\n'), out))
        self.assertEqual({'error_code': 'request_invalid'}, json.loads(out.getvalue()))
        with patch.object(effect, 'execute', lambda *_a: (_ for _ in ()).throw(RuntimeError('leaky'))):
            out = io.StringIO()
            self.assertEqual(1, effect.main(io.StringIO(json.dumps(request(stateDir=self.state_dir)) + '\n'), out))
        self.assertEqual({'error_code': 'script_failed'}, json.loads(out.getvalue()))


if __name__ == '__main__':
    unittest.main()
