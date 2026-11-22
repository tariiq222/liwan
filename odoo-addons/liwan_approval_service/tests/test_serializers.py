# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import KIND, RESOLVER, ApprovalCase
from odoo.addons.liwan_approval_service.serializers.operations import (
    dump_process,
    dump_request,
    dump_request_steps,
    dump_summary,
)

PERSON = {'id', 'user_id', 'name'}
PROCESS_KEYS = {'id', 'name', 'description', 'purpose', 'stage_approval_mode', 'state', 'revision', 'execution_kind', 'steps'}
STEP_KEYS = {'name', 'reviewer_ids', 'reviewers', 'ineligible_reviewer_ids', 'resolver', 'resolver_label'}
SUMMARY_KEYS = {'id', 'name', 'process', 'process_revision', 'purpose', 'state', 'revision', 'cycle', 'requester', 'created_at', 'execution_count'}
REQUEST_KEYS = SUMMARY_KEYS | {'description', 'target', 'steps', 'events', 'attachments', 'allowed_actions'}
REQUEST_STEP_KEYS = {'sequence', 'name', 'reviewers', 'status', 'resolver', 'resolver_label'}
EVENT_KEYS = {'id', 'kind', 'actor', 'comment', 'cycle', 'created_at'}


class TestSerializers(ApprovalCase):

    def test_a_process_exposes_only_its_whitelisted_keys(self):
        process = self.published_process([{'name': 'One', 'reviewer_ids': [self.reviewer.id, self.reviewer2.id]}, {'name': 'Two', 'reviewer_ids': [self.reviewer.id]}], purpose='employee', mode='single')
        body = dump_process(process.with_user(self.manager))
        self.assertEqual(set(body), PROCESS_KEYS)
        self.assertEqual((body['state'], body['revision'], body['purpose'], body['stage_approval_mode'], body['execution_kind']), ('published', 1, 'employee', 'single', 'approval'))
        self.assertEqual([step['name'] for step in body['steps']], ['One', 'Two'])
        for step in body['steps']:
            self.assertEqual(set(step), STEP_KEYS)
            for person in step['reviewers']:
                self.assertEqual(set(person), PERSON)
        self.assertEqual(body['steps'][0]['reviewer_ids'], sorted([self.reviewer.id, self.reviewer2.id]))
        self.assertEqual(body['steps'][0]['ineligible_reviewer_ids'], [])
        self.assertEqual((body['steps'][0]['resolver'], body['steps'][0]['resolver_label']), (None, None))

    def test_a_step_reports_a_reviewer_who_lost_the_capability_and_a_resolver_label(self):
        process = self.published_process([{'name': 'One', 'reviewer_ids': [self.reviewer.id]}, {'name': 'Auto', 'resolver': RESOLVER}], kind=KIND)
        self.service._liwan_replace_assignments(self.reviewer, [])
        steps = dump_process(process)['steps']
        self.assertEqual(steps[0]['ineligible_reviewer_ids'], [self.reviewer.id])
        self.assertEqual((steps[1]['resolver'], steps[1]['resolver_label'], steps[1]['reviewers']), (RESOLVER, 'Test resolver', []))

    def test_a_summary_exposes_only_its_whitelisted_keys(self):
        record = self.pending_request(self.published_process(name='Leave'))
        body = dump_summary(record)
        self.assertEqual(set(body), SUMMARY_KEYS)
        self.assertEqual(body['process'], {'id': record.process_id.id, 'name': 'Leave'})
        self.assertEqual(body['requester'], {'id': self.requester.id, 'user_id': self.requester.id, 'name': self.requester.name})
        self.assertEqual((body['state'], body['cycle'], body['execution_count'], body['purpose']), ('pending', 1, 0, 'work'))
        self.assertTrue(body['created_at'])

    def test_a_request_exposes_steps_events_and_the_actions_of_the_viewer(self):
        record = self.pending_request()
        body = dump_request(record.with_user(self.reviewer))
        self.assertEqual(set(body), REQUEST_KEYS)
        self.assertEqual((body['target'], body['attachments']), (None, []))
        self.assertEqual([set(step) for step in body['steps']], [REQUEST_STEP_KEYS])
        self.assertEqual([set(event) for event in body['events']], [EVENT_KEYS])
        self.assertEqual([event['kind'] for event in body['events']], ['submitted'])
        self.assertTrue(body['allowed_actions']['approve'])
        self.assertFalse(dump_request(record.with_user(self.requester))['allowed_actions']['approve'])

    def test_the_step_status_follows_the_request_state(self):
        process = self.published_process()

        def statuses(record):
            return [step['status'] for step in dump_request_steps(record)]

        draft = self.draft_request(process)
        self.assertEqual(statuses(draft), [])
        pending = self.pending_request(process)
        self.assertEqual(statuses(pending), ['pending'])
        returned = self.pending_request(process)
        returned.with_user(self.reviewer).action_return(returned.revision, 'Fix')
        self.assertEqual(statuses(returned), ['waiting'])
        done = self.pending_request(process)
        done.with_user(self.reviewer).action_approve(done.revision)
        self.assertEqual(statuses(done), ['approved'])
        rejected = self.pending_request(process)
        rejected.with_user(self.reviewer).action_reject(rejected.revision, 'No')
        self.assertEqual(statuses(rejected), ['rejected'])

    def test_a_skipped_stage_reads_skipped_and_the_resolver_is_opt_in(self):
        self.skippable = True
        self.resolved = self.requester
        process = self.published_process([{'name': 'Auto', 'resolver': RESOLVER}, {'name': 'Fixed', 'reviewer_ids': [self.reviewer.id]}], kind=KIND)
        record = self.pending_request(process)
        steps = dump_request_steps(record, include_resolver=True)
        self.assertEqual([(s['status'], s['resolver'], s['resolver_label']) for s in steps], [('skipped', RESOLVER, 'Test resolver'), ('pending', None, None)])
        self.assertNotIn('resolver', dump_request_steps(record)[0])
