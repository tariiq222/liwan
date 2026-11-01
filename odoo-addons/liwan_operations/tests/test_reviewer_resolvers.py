# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, Command
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_operations.models.common import EXTERNAL_CLOSE, TOKEN
from odoo.addons.liwan_operations.models.operation_request import (
    OperationExecutionError,
)
from odoo.addons.liwan_operations.serializers.operations import (
    dump_process,
    dump_request,
)

KIND = 'test_kind'
RESOLVER = 'test_resolver'


@tagged('post_install', '-at_install', 'liwan')
class TestReviewerResolvers(LiwanApiCase):
    """The engine's extension points, exercised through a resolver kind defined only here."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.manager = new_test_user(cls.env, login='res_manager', password='res_manager_test_123', groups='liwan_core.group_employee')
        cls.reviewer = new_test_user(cls.env, login='res_reviewer', password='res_reviewer_test_123', groups='liwan_core.group_employee')
        cls.approver = new_test_user(cls.env, login='res_approver', password='res_approver_test_123', groups='liwan_core.group_employee')
        cls.other = new_test_user(cls.env, login='res_other', password='res_other_test_123', groups='liwan_core.group_employee')
        for user, role in [(cls.employee, 'liwan_core.role_employee'), (cls.approver, 'liwan_core.role_employee'), (cls.other, 'liwan_core.role_employee'),
                           (cls.manager, 'liwan_operations.role_operations_manager'), (cls.reviewer, 'liwan_operations.role_operations_reviewer')]:
            cls.service._liwan_replace_assignments(user, [{'role_id': cls.env.ref(role).id, 'company_id': cls.env.company.id}])

    def setUp(self):
        super().setUp()
        self.resolved = self.approver
        self.capability = 'operations.requests.read'
        self.skippable = False
        self.executed = []
        process_cls = type(self.env['liwan.operation.process'])
        request_cls = type(self.env['liwan.operation.request'])
        test = self

        def kinds(this):
            return ('approval', KIND)

        def resolvers(this, execution_kind):
            return ({'key': RESOLVER, 'label': 'Test approver', 'capability': test.capability, **({'skip_when_empty': True} if test.skippable else {})},) if execution_kind == KIND else ()

        def application_kinds(this):
            return (KIND,)

        def resolve(this, key):
            return test.resolved

        def approved(this):
            test.executed.append('approved')
            return True

        self.patch(process_cls, '_operations_execution_kinds', kinds)
        self.patch(process_cls, '_operations_reviewer_resolvers', resolvers)
        self.patch(process_cls, '_operations_application_kinds', application_kinds)
        self.patch(request_cls, '_operations_resolve_reviewers', resolve)
        self.patch(request_cls, '_execute_approved', approved)

    def _process(self, steps=None, kind=KIND, name='Resolved approval'):
        steps = steps or [{'name': 'Resolved', 'reviewer_ids': [], 'resolver': RESOLVER}, {'name': 'Fixed', 'reviewer_ids': [self.reviewer.id]}]
        process = self.env['liwan.operation.process'].with_user(self.manager).create({'name': name})
        process.action_configure(0, name, '', kind, steps, purpose='employee')
        process.action_publish(1)
        return process

    def _pending(self, process):
        record = self.env['liwan.operation.request'].with_user(self.employee).create({'name': 'Resolved request', 'process_id': process.id})
        record.action_submit(0)
        return record

    def test_snapshot_is_the_only_source_of_reviewers(self):
        record = self._pending(self._process())
        first, second = record.stage_snapshot
        self.assertEqual((first['resolver'], first['capability'], first['reviewer_ids']), (RESOLVER, 'operations.requests.read', [self.approver.id]))
        self.assertEqual((second['resolver'], second['capability'], second['reviewer_ids']), (None, 'operations.requests.review', [self.reviewer.id]))
        self.assertEqual(record.review_ids.sorted('sequence')[0].reviewer_ids, self.approver)
        # The resolver now names someone else, but the submitted snapshot still decides.
        self.resolved = self.other
        with self.assertRaises(AccessError):
            record.with_user(self.other).action_approve(1)
        record.with_user(self.approver).action_approve(1)
        record.with_user(self.reviewer).action_approve(2)
        self.assertEqual((record.state, self.executed), ('done', ['approved']))

    def test_resolver_users_need_the_stage_capability_and_never_the_requester(self):
        self.capability = 'operations.requests.review'
        process = self._process()
        request = self.env['liwan.operation.request'].with_user(self.employee).create({'name': 'No reviewer', 'process_id': process.id})
        with self.assertRaises(ValidationError):
            request.action_submit(0)
        self.capability = 'operations.requests.read'
        self.resolved = self.employee
        with self.assertRaises(ValidationError):
            request.action_submit(0)

    def test_a_skippable_stage_without_reviewer_is_skipped_and_audited(self):
        self.skippable = True
        self.resolved = self.employee
        record = self._pending(self._process())
        first, second = record.stage_snapshot
        self.assertEqual((first['skipped'], first['reviewer_ids'], second['skipped'], second['reviewer_ids']), (True, [], False, [self.reviewer.id]))
        self.assertEqual([(r.sequence, r.status) for r in record.review_ids.sorted('sequence')], [(1, 'approved'), (2, 'pending')])
        self.assertEqual([step['status'] for step in dump_request(record)['steps']], ['skipped', 'pending'])
        events = record.event_ids
        skip = events.filtered(lambda e: e.kind == 'stage_skipped')
        self.assertEqual((len(skip), skip.comment), (1, 'Resolved'))
        self.assertEqual(record.review_ids.filtered(lambda r: r.sequence == 1).done_by.id, False)
        self.assertTrue(record.with_user(self.reviewer)._operations_allowed_actions()['approve'])
        self.assertFalse(record.with_user(self.approver)._operations_allowed_actions()['approve'])
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'done')

    def test_a_skippable_stage_with_a_reviewer_is_not_skipped(self):
        self.skippable = True
        record = self._pending(self._process())
        self.assertEqual([stage['skipped'] for stage in record.stage_snapshot], [False, False])
        self.assertFalse(record.event_ids.filtered(lambda e: e.kind == 'stage_skipped'))

    def test_a_process_whose_every_stage_is_skipped_is_refused(self):
        self.skippable = True
        self.resolved = self.employee
        process = self._process([{'name': 'Only', 'reviewer_ids': [], 'resolver': RESOLVER}])
        request = self.env['liwan.operation.request'].with_user(self.employee).create({'name': 'Nobody', 'process_id': process.id})
        with self.assertRaises(ValidationError):
            request.action_submit(0)

    def test_an_unskippable_stage_without_reviewer_names_the_stage(self):
        self.skippable = True
        process = self._process()
        self.reviewer.active = False
        request = self.env['liwan.operation.request'].with_user(self.employee).create({'name': 'Stuck', 'process_id': process.id})
        with self.assertRaisesRegex(ValidationError, 'Fixed'):
            request.action_submit(0)

    def test_losing_the_current_stage_capability_does_not_let_a_later_stage_be_decided(self):
        self.capability = 'operations.processes.manage'
        company = self.env.company.id
        roles = [{'role_id': self.env.ref(role).id, 'company_id': company} for role in ('liwan_operations.role_operations_manager', 'liwan_operations.role_operations_reviewer')]
        self.service._liwan_replace_assignments(self.approver, roles)
        for mode in ('per_stage', 'single'):
            steps = [{'name': 'Resolved', 'reviewer_ids': [], 'resolver': RESOLVER}, {'name': 'Fixed', 'reviewer_ids': [self.approver.id]}]
            process = self.env['liwan.operation.process'].with_user(self.manager).create({'name': f'Skip {mode}'})
            process.action_configure(0, f'Skip {mode}', '', KIND, steps, purpose='employee', stage_approval_mode=mode)
            process.action_publish(process.revision)
            record = self._pending(process)
            self.service._liwan_replace_assignments(self.approver, roles[1:])
            revision = record.revision
            with self.assertRaises(AccessError):
                record.with_user(self.approver).action_approve(revision)
            with self.assertRaises(AccessError):
                record.with_user(self.approver).action_reject(revision, 'No')
            record.invalidate_recordset()
            self.assertEqual((record.state, [r.status for r in record.review_ids.sorted('sequence')], self.executed), ('pending', ['pending', 'waiting'], []))
            self.assertFalse(record.with_user(self.approver)._operations_allowed_actions()['approve'])
            self.service._liwan_replace_assignments(self.approver, roles)

    def test_stage_capability_is_checked_when_deciding(self):
        record = self._pending(self._process())
        self.service._liwan_replace_assignments(self.approver, [])
        with self.assertRaises(AccessError):
            record.with_user(self.approver).action_approve(1)

    def test_resolver_reviewer_sees_the_request_in_the_pending_queue_without_review_capability(self):
        record = self._pending(self._process())
        self.authenticate('res_approver', 'res_approver_test_123')
        pending = self.api('GET', '/api/v1/operations/requests?scope=pending')
        self.assertEqual([item['id'] for item in pending.json()['items']], [record.id])
        self.assertTrue(record.with_user(self.approver)._operations_allowed_actions()['approve'])
        self.authenticate('res_other', 'res_other_test_123')
        self.assertEqual(self.api('GET', '/api/v1/operations/requests?scope=pending').json()['total'], 0)

    def test_process_revision_change_leaves_pending_requests_on_their_stages(self):
        process = self._process()
        record = self._pending(process)
        snapshot = record.stage_snapshot
        process.with_user(self.manager).action_configure(1, 'Changed', '', 'approval', [{'name': 'Other', 'reviewer_ids': [self.reviewer.id]}])
        process.with_user(self.manager).action_publish(2)
        self.assertEqual(record.stage_snapshot, snapshot)
        record.with_user(self.approver).action_approve(1)
        record.with_user(self.reviewer).action_approve(2)
        self.assertEqual(record.state, 'done')

    def test_configuration_validates_the_resolver_and_serializes_it(self):
        manager = self.env['liwan.operation.process'].with_user(self.manager)
        process = manager.create({'name': 'Invalid'})
        for step in ({'name': 'A', 'reviewer_ids': [], 'resolver': 'unknown'},
                     {'name': 'A', 'reviewer_ids': [self.reviewer.id], 'resolver': RESOLVER},
                     {'name': 'A', 'resolver': 5}, {'name': 'A', 'reviewer_ids': []}, {'name': 'A', 'extra': 1}):
            with self.assertRaises(ValidationError):
                process.action_configure(0, 'Invalid', '', KIND, [step])
        with self.assertRaises(ValidationError):
            process.action_configure(0, 'Invalid', '', 'approval', [{'name': 'A', 'resolver': RESOLVER}])
        dumped = dump_process(self._process())['steps']
        self.assertEqual([(s['resolver'], s['resolver_label'], s['reviewer_ids']) for s in dumped], [(RESOLVER, 'Test approver', []), (None, None, [self.reviewer.id])])
        self.assertEqual(dump_request(self._pending(self._process()))['steps'][0]['resolver'], RESOLVER)

    def test_step_needs_named_reviewers_or_a_resolver(self):
        process = self._process()
        step = process.step_ids.sorted('sequence')[0]
        with self.assertRaises(ValidationError):
            step.with_context(_operations_write=TOKEN).write({'reviewer_ids': [Command.set([self.reviewer.id])]})
        named = process.step_ids.sorted('sequence')[1]
        with self.assertRaises(ValidationError):
            named.with_context(_operations_write=TOKEN).write({'reviewer_ids': [Command.clear()]})

    def test_rejection_hook_runs_once_and_a_failure_rolls_the_decision_back(self):
        process_one = self._process(name='Reject ok')
        record = self._pending(process_one)
        calls = []
        self.patch(type(record), '_execute_rejected', lambda this: calls.append(this.id) or True)
        record.with_user(self.approver).action_return(1, 'Needs detail')
        self.assertEqual(calls, [])
        record.action_submit(2)
        record.with_user(self.approver).action_reject(3, 'No')
        self.assertEqual((record.state, calls), ('rejected', [record.id]))

        failing = self._pending(self._process(name='Reject fails'))

        def fail(this):
            message = 'The subject changed.'
            raise ValidationError(message)
        self.patch(type(failing), '_execute_rejected', fail)
        # Odoo's assertRaises rolls back the block, which would also discard the failure audit being checked.
        try:
            failing.with_user(self.approver).action_reject(1, 'No')
        except OperationExecutionError:
            pass
        else:
            self.fail('the rejection hook failure must surface')
        failing.invalidate_recordset()
        self.assertEqual((failing.state, failing.revision), ('pending', 1))
        events = self.env['liwan.operation.event'].search([('request_id', '=', failing.id)]).mapped('kind')
        self.assertEqual(events.count('execution_failed'), 1)
        self.assertNotIn('rejected', events)

    def test_requestable_filter_leaves_application_kinds_out(self):
        own = self._process(name='Application owned')
        plain = self._process([{'name': 'Plain', 'reviewer_ids': [self.reviewer.id]}], kind='approval', name='Plain process')
        self.authenticate('api_emp', 'api_emp_pass_123')
        everything = self.api('GET', '/api/v1/operations/processes?published=1').json()
        self.assertLessEqual({own.id, plain.id}, {item['id'] for item in everything['items']})
        requestable = self.api('GET', '/api/v1/operations/processes?published=1&requestable=1').json()
        ids = [item['id'] for item in requestable['items']]
        self.assertIn(plain.id, ids)
        self.assertNotIn(own.id, ids)

    def test_reviewer_resolvers_route(self):
        self.authenticate('res_manager', 'res_manager_test_123')
        result = self.api('GET', f'/api/v1/operations/processes/reviewer-resolvers?execution_kind={KIND}')
        self.assertEqual((result.status_code, result.json()), (200, {'items': [{'key': RESOLVER, 'label': 'Test approver'}], 'total': 1}))
        self.assertEqual(self.api('GET', '/api/v1/operations/processes/reviewer-resolvers?execution_kind=approval').json(), {'items': [], 'total': 0})
        self.assertEqual(self.api('GET', '/api/v1/operations/processes/reviewer-resolvers?execution_kind=nope').status_code, 422)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/operations/processes/reviewer-resolvers?execution_kind={KIND}').status_code, 403)

    def test_seed_needs_the_installation_operator(self):
        steps = [{'name': 'Seeded', 'reviewer_ids': [], 'resolver': RESOLVER}, {'name': 'Fixed', 'reviewer_ids': [self.reviewer.id]}]
        vals = {'name': 'Seeded process', 'description': '', 'execution_kind': KIND, 'purpose': 'employee'}
        with self.assertRaises(AccessError):
            self.env['liwan.operation.process'].with_user(self.manager)._operations_seed(self.env.company, vals, steps)
        seeded = self.env['liwan.operation.process'].with_user(SUPERUSER_ID)._operations_seed(self.env.company, vals, steps)
        seeded = seeded.with_env(self.env)
        self.assertEqual((seeded.state, seeded.revision, seeded.company_id, seeded.purpose), ('published', 1, self.env.company, 'employee'))
        self.assertEqual(seeded.step_ids.sorted('sequence').mapped('reviewer_resolver'), [RESOLVER, False])
        self.assertEqual(len(self.env['tier.definition'].search([('operations_process_id', '=', seeded.id)])), 2)

    def test_close_externally_is_a_token_guarded_terminal_without_execution(self):
        record = self._pending(self._process())
        with self.assertRaises(AccessError):
            record._operations_close_externally('Decided elsewhere')
        with self.assertRaises(AccessError):
            record.with_context(operations_external_close=True)._operations_close_externally('Decided elsewhere')
        record.with_context(operations_external_close=EXTERNAL_CLOSE)._operations_close_externally('Decided elsewhere')
        self.assertEqual((record.state, self.executed), ('withdrawn', []))
        event = record.event_ids.filtered(lambda e: e.kind == 'closed_externally')
        self.assertEqual(event.comment, 'Decided elsewhere')
        with self.assertRaises(AccessError):
            record.with_user(self.approver).action_approve(record.revision)
        self.authenticate('res_approver', 'res_approver_test_123')
        self.assertEqual(self.api('GET', '/api/v1/operations/requests?scope=pending').json()['total'], 0)
