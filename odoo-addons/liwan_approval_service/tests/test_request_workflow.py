# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError

from .common import KIND, RESOLVER, ApprovalCase
from odoo.addons.liwan_approval_service.models.common import EXTERNAL_CLOSE
from odoo.addons.liwan_approval_service.models.operation_request import (
    OperationExecutionError,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule


class TestRequestCreation(ApprovalCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reader = cls._member('apr_reader', cls.company, ['operations.requests.read'])

    def test_a_requester_files_a_draft_owned_by_them_with_the_process_snapshot(self):
        process = self.published_process(purpose='employee', name='Travel')
        record = self.request_as(self.requester).create({'name': ' Trip ', 'description': 'Riyadh', 'process_id': process.id})
        self.assertEqual((record.name, record.state, record.revision, record.cycle, record.requester_id), ('Trip', 'draft', 0, 0, self.requester))
        self.assertEqual((record.process_name, record.purpose, record.execution_kind, record.company_id), ('Travel', 'employee', 'approval', self.company))
        self.assertEqual((bool(record.stage_snapshot), record.participant_ids, record.execution_count), (False, self.env['res.users'], 0))

    def test_control_fields_cannot_be_supplied(self):
        process = self.published_process()
        for extra in ({'state': 'done'}, {'requester_id': self.manager.id}, {'revision': 9}, {'stage_snapshot': [1]}, {'purpose': 'employee'}):
            with self.assertRaisesRegex(AccessError, 'control fields'):
                self.request_as(self.requester).create({'name': 'R', 'process_id': process.id, **extra})

    def test_only_a_published_process_of_the_current_company_is_accepted(self):
        draft = self.process_as(self.manager).create({'name': 'Draft'})
        archived = self.published_process(name='Old')
        archived.action_archive(archived.revision)
        other = self.env['res.company'].create({'name': 'Elsewhere'})
        foreign = self.env['liwan.operation.process'].with_company(other).create({'name': 'Foreign'})
        foreign.write({'state': 'published'})
        for process_id in (draft.id, archived.id, foreign.id, 999999999, True, '1', None):
            with self.assertRaisesRegex(ValidationError, 'published process', msg=repr(process_id)):
                self.request_as(self.requester).create({'name': 'R', 'process_id': process_id})

    def test_creating_needs_the_create_capability_and_a_valid_name(self):
        process = self.published_process()
        with self.assertRaises(AccessError):
            self.request_as(self.reader).create({'name': 'R', 'process_id': process.id})
        for name in ('', '  ', None, 'x' * 201):
            with self.assertRaises(ValidationError, msg=repr(name)):
                self.request_as(self.requester).create({'name': name, 'process_id': process.id})

    def test_a_request_cannot_name_a_linked_record_or_another_company(self):
        process = self.published_process()
        with self.assertRaisesRegex(ValidationError, 'linked record'):
            self.request_as(self.requester).create({'name': 'R', 'process_id': process.id, 'target_id': 3})
        other = self.env['res.company'].create({'name': 'Elsewhere'})
        with self.assertRaises(AccessError):
            self.request_as(self.requester).create({'name': 'R', 'process_id': process.id, 'company_id': other.id})

    def test_the_requester_edits_an_open_draft_through_the_action_only(self):
        record = self.draft_request(self.published_process())
        record.with_user(self.requester).action_update(0, 'Renamed', 'Notes')
        self.assertEqual((record.name, record.description, record.revision), ('Renamed', 'Notes', 1))
        with self.assertRaises(LiwanAccessRule) as caught:
            record.with_user(self.requester).action_update(0, 'Again', '')
        self.assertEqual(caught.exception.status, 409)
        for vals in ({'state': 'done'}, {'requester_id': self.manager.id}, {'revision': 7}):
            with self.assertRaisesRegex(AccessError, 'operations transition'):
                record.with_user(self.requester).write(vals)
        record.with_user(self.requester).write({'name': 'Direct'})
        self.assertEqual((record.name, record.revision), ('Direct', 2))

    def test_nobody_else_edits_the_draft_and_a_pending_request_is_frozen(self):
        record = self.draft_request(self.published_process())
        for user in (self.bystander, self.manager, self.reviewer):
            with self.assertRaises(AccessError):
                record.with_user(user).action_update(0, 'Hijack', '')
        pending = self.pending_request()
        with self.assertRaisesRegex(AccessError, 'open draft'):
            pending.with_user(self.requester).action_update(pending.revision, 'Late', '')

    def test_a_request_is_never_deleted(self):
        record = self.draft_request(self.published_process())
        for user in (self.requester, self.manager):
            with self.assertRaises(AccessError):
                record.with_user(user).unlink()
        with self.assertRaises(AccessError):
            record.unlink()


class TestSubmission(ApprovalCase):

    def test_submit_snapshots_the_stages_and_opens_the_first_review(self):
        process = self.published_process([{'name': 'One', 'reviewer_ids': [self.reviewer.id]}, {'name': 'Two', 'reviewer_ids': [self.reviewer.id, self.reviewer2.id]}], mode='single')
        record = self.pending_request(process)
        self.assertEqual((record.state, record.cycle, record.revision, record.process_revision, record.stage_approval_mode), ('pending', 1, 1, process.revision, 'single'))
        self.assertEqual([(s['sequence'], s['name'], sorted(s['reviewer_ids']), s['capability'], s['skipped']) for s in record.stage_snapshot],
                         [(1, 'One', [self.reviewer.id], 'operations.requests.review', False), (2, 'Two', sorted([self.reviewer.id, self.reviewer2.id]), 'operations.requests.review', False)])
        self.assertEqual(record.participant_ids, self.requester | self.reviewer | self.reviewer2)
        self.assertEqual([(r.sequence, r.status) for r in record.review_ids.sorted('sequence')], [(1, 'pending'), (2, 'waiting')])
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted'])

    def test_the_snapshot_survives_a_later_process_revision(self):
        process = self.published_process()
        record = self.pending_request(process)
        snapshot = record.stage_snapshot
        process.action_configure(1, 'Approval', '', 'approval', [{'name': 'Other', 'reviewer_ids': [self.reviewer2.id]}])
        process.action_publish(2)
        self.assertEqual(record.stage_snapshot, snapshot)
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'done')

    def test_a_request_is_submitted_once_and_only_by_its_requester(self):
        record = self.draft_request(self.published_process())
        for user in (self.bystander, self.reviewer, self.manager):
            with self.assertRaises(AccessError):
                record.with_user(user).action_submit(0)
        record.with_user(self.requester).action_submit(0)
        with self.assertRaises(AccessError):
            record.with_user(self.requester).action_submit(record.revision)

    def test_submit_refuses_a_stale_revision(self):
        record = self.draft_request(self.published_process())
        with self.assertRaises(LiwanAccessRule) as caught:
            record.with_user(self.requester).action_submit(3)
        self.assertEqual(caught.exception.code, 'conflict')
        self.assertEqual(record.state, 'draft')

    def test_submit_refuses_an_archived_process(self):
        process = self.published_process()
        record = self.draft_request(process)
        process.action_archive(process.revision)
        with self.assertRaisesRegex(ValidationError, 'must be published'):
            record.with_user(self.requester).action_submit(0)

    def test_the_requester_never_reviews_their_own_request(self):
        requester_reviewer = self._member('apr_self_reviewer', self.company, ['operations.requests.read', 'operations.requests.create', 'operations.requests.review'])
        process = self.published_process([{'name': 'Mine', 'reviewer_ids': [requester_reviewer.id]}])
        record = self.draft_request(process, requester_reviewer)
        with self.assertRaisesRegex(ValidationError, 'Mine'):
            record.with_user(requester_reviewer).action_submit(0)

    def test_subject_users_never_review_even_when_a_stage_names_them(self):
        self.patch(type(self.env['liwan.operation.request']), '_operations_subject_users', lambda this: self.reviewer2)
        process = self.published_process([{'name': 'Only', 'reviewer_ids': [self.reviewer2.id]}])
        with self.assertRaisesRegex(ValidationError, 'no eligible reviewer'):
            self.draft_request(process).with_user(self.requester).action_submit(0)
        process = self.published_process([{'name': 'Both', 'reviewer_ids': [self.reviewer.id, self.reviewer2.id]}], name='Both')
        record = self.pending_request(process)
        self.assertEqual(record.stage_snapshot[0]['reviewer_ids'], [self.reviewer.id])

    def test_a_reviewer_who_lost_the_capability_since_publication_is_dropped_from_the_snapshot(self):
        process = self.published_process([{'name': 'Both', 'reviewer_ids': [self.reviewer.id, self.reviewer2.id]}])
        self.service._liwan_replace_assignments(self.reviewer2, [])
        record = self.pending_request(process)
        self.assertEqual(record.stage_snapshot[0]['reviewer_ids'], [self.reviewer.id])
        self.service._liwan_replace_assignments(self.reviewer, [])
        with self.assertRaisesRegex(ValidationError, 'no eligible reviewer'):
            self.draft_request(process).with_user(self.requester).action_submit(0)

    def test_resolver_stages_use_the_resolved_reviewers_and_the_resolver_capability(self):
        process = self.published_process([{'name': 'Resolved', 'resolver': RESOLVER}], kind=KIND)
        record = self.pending_request(process)
        self.assertEqual((record.stage_snapshot[0]['resolver'], record.stage_snapshot[0]['reviewer_ids']), (RESOLVER, [self.reviewer.id]))
        self.resolved = self.reviewer | self.bystander
        self.assertEqual(self.pending_request(process).stage_snapshot[0]['reviewer_ids'], [self.reviewer.id])
        self.resolved = self.bystander
        with self.assertRaisesRegex(ValidationError, 'no eligible reviewer'):
            self.draft_request(process).with_user(self.requester).action_submit(0)

    def test_a_skippable_stage_without_reviewers_is_skipped_and_audited(self):
        self.skippable = True
        self.resolved = self.requester
        process = self.published_process([{'name': 'Optional', 'resolver': RESOLVER}, {'name': 'Fixed', 'reviewer_ids': [self.reviewer.id]}], kind=KIND)
        record = self.pending_request(process)
        self.assertEqual([s['skipped'] for s in record.stage_snapshot], [True, False])
        self.assertEqual([(r.sequence, r.status) for r in record.review_ids.sorted('sequence')], [(1, 'approved'), (2, 'pending')])
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'stage_skipped'])
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'done')

    def test_a_process_whose_every_stage_is_skipped_is_refused(self):
        self.skippable = True
        self.resolved = self.requester
        process = self.published_process([{'name': 'Optional', 'resolver': RESOLVER}], kind=KIND)
        with self.assertRaisesRegex(ValidationError, 'Every stage'):
            self.draft_request(process).with_user(self.requester).action_submit(0)

    def test_an_unowned_feature_refuses_submission(self):
        record = self.draft_request(self.published_process())
        self.patch(type(self.env['liwan.operation.process']), '_operations_feature', lambda this, kind: None)
        with self.assertRaisesRegex(AccessError, 'No installed application'):
            record.with_user(self.requester).action_submit(0)


class TestDecisions(ApprovalCase):

    def _two_stages(self, mode, second=None, kind='approval'):
        steps = [{'name': 'One', 'reviewer_ids': [self.reviewer.id]}, {'name': 'Two', 'reviewer_ids': [(second or self.reviewer2).id]}]
        return self.pending_request(self.published_process(steps, mode=mode, kind=kind))

    def _fails(self, action, *args):
        # The harness's assertRaises rolls its savepoint back, which would also drop the failure audit row the test inspects.
        try:
            action(*args)
        except OperationExecutionError:
            return
        self.fail('the execution failure was not raised')

    def _statuses(self, record):
        record.invalidate_recordset()
        return [r.status for r in record.review_ids.sorted('sequence')]

    def test_one_stage_approval_completes_executes_and_audits(self):
        process = self.published_process(kind=KIND)
        record = self.pending_request(process)
        record.with_user(self.reviewer).action_approve(record.revision, 'Fine')
        self.assertEqual((record.state, record.execution_count, self.executed), ('done', 1, [record.id]))
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'approved', 'executed'])
        approval = record.event_ids.filtered(lambda e: e.kind == 'approved')
        self.assertEqual((approval.actor_id, approval.comment, approval.cycle), (self.reviewer, 'Fine', 1))
        self.assertEqual(approval.evidence['stages'], record.stage_snapshot)
        self.assertEqual(approval.evidence['review_statuses'], [{'sequence': 1, 'status': 'approved'}])

    def test_the_built_in_approval_kind_executes_nothing_else(self):
        record = self.pending_request()
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual((record.state, record.execution_count, self.executed), ('done', 1, []))

    def test_stages_are_decided_in_order_and_each_needs_its_own_approval(self):
        record = self._two_stages('per_stage')
        with self.assertRaisesRegex(AccessError, 'current stage reviewer'):
            record.with_user(self.reviewer2).action_approve(record.revision)
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual((record.state, self._statuses(record)), ('pending', ['approved', 'pending']))
        with self.assertRaisesRegex(AccessError, 'current stage reviewer'):
            record.with_user(self.reviewer).action_approve(record.revision)
        record.with_user(self.reviewer2).action_approve(record.revision)
        self.assertEqual((record.state, self._statuses(record)), ('done', ['approved', 'approved']))

    def test_a_reviewer_on_consecutive_stages_approves_each_in_per_stage_mode(self):
        record = self._two_stages('per_stage', second=self.reviewer)
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'pending')
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'done')

    def test_one_approval_covers_the_consecutive_stages_of_one_reviewer_in_single_mode(self):
        record = self._two_stages('single', second=self.reviewer)
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual((record.state, self._statuses(record)), ('done', ['approved', 'approved']))

    def test_single_mode_stops_at_a_stage_of_another_reviewer(self):
        record = self._two_stages('single')
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual((record.state, self._statuses(record)), ('pending', ['approved', 'pending']))

    def test_only_a_stage_reviewer_can_decide(self):
        record = self.pending_request()
        for user in (self.bystander, self.manager, self.monitor, self.requester):
            for action in (lambda u=user: record.with_user(u).action_approve(record.revision),
                           lambda u=user: record.with_user(u).action_reject(record.revision, 'No'),
                           lambda u=user: record.with_user(u).action_return(record.revision, 'Fix')):
                with self.assertRaises(AccessError):
                    action()
        self.assertEqual((record.state, record.execution_count), ('pending', 0))

    def test_a_reviewer_who_lost_the_capability_cannot_decide(self):
        record = self.pending_request()
        self.service._liwan_replace_assignments(self.reviewer, [])
        with self.assertRaises(AccessError):
            record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'pending')

    def test_a_decision_is_taken_once(self):
        record = self.pending_request()
        record.with_user(self.reviewer).action_approve(record.revision)
        for action in (lambda: record.with_user(self.reviewer).action_approve(record.revision),
                       lambda: record.with_user(self.reviewer).action_reject(record.revision, 'Late'),
                       lambda: record.with_user(self.reviewer).action_return(record.revision, 'Late')):
            with self.assertRaisesRegex(AccessError, 'not available for your decision'):
                action()
        self.assertEqual((record.state, record.execution_count), ('done', 1))

    def test_a_stale_revision_is_a_conflict(self):
        record = self.pending_request()
        for name, args in (('action_approve', ()), ('action_reject', ('No',)), ('action_return', ('No',))):
            for revision in (record.revision - 1, record.revision + 1):
                with self.assertRaises(LiwanAccessRule, msg=name) as caught:
                    getattr(record.with_user(self.reviewer), name)(revision, *args)
                self.assertEqual((caught.exception.code, caught.exception.status), ('conflict', 409))
        self.assertEqual(record.state, 'pending')

    def test_rejecting_and_returning_need_a_comment(self):
        record = self.pending_request()
        for name in ('action_reject', 'action_return'):
            for comment in ('', '   ', None, 'x' * 4001):
                with self.assertRaises(ValidationError, msg=repr(comment)):
                    getattr(record.with_user(self.reviewer), name)(record.revision, comment)
        self.assertEqual(record.state, 'pending')

    def test_rejection_is_terminal_runs_its_effect_and_audits(self):
        record = self.pending_request(self.published_process(kind=KIND))
        record.with_user(self.reviewer).action_reject(record.revision, 'No budget')
        self.assertEqual((record.state, self.rejected, self.executed, record.execution_count), ('rejected', [record.id], [], 0))
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'rejected'])
        self.assertEqual(record.event_ids[-1].comment, 'No budget')
        for action in (lambda: record.with_user(self.requester).action_withdraw(record.revision),
                       lambda: record.with_user(self.requester).action_submit(record.revision),
                       lambda: record.with_user(self.requester).action_update(record.revision, 'N', '')):
            with self.assertRaises(AccessError):
                action()

    def test_a_returned_request_is_edited_and_resubmitted_as_a_new_cycle(self):
        record = self.pending_request()
        record.with_user(self.reviewer).action_return(record.revision, 'Add detail')
        self.assertEqual((record.state, record.cycle), ('returned', 1))
        record.with_user(self.requester).action_update(record.revision, 'Better', 'Detail')
        record.with_user(self.requester).action_submit(record.revision)
        self.assertEqual((record.state, record.cycle, record.name), ('pending', 2, 'Better'))
        self.assertEqual([(r.sequence, r.status) for r in record.review_ids.sorted('sequence')], [(1, 'pending')])
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'done')
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'returned', 'submitted', 'approved', 'executed'])
        self.assertEqual(record.event_ids.mapped('cycle'), [1, 1, 2, 2, 2])

    def test_a_failing_approval_effect_rolls_the_decision_back_and_leaves_a_failure_event(self):
        record = self.pending_request(self.published_process(kind=KIND))
        self.fail_execution = True
        self._fails(record.with_user(self.reviewer).action_approve, record.revision)
        record.invalidate_recordset()
        self.assertEqual((record.state, record.execution_count, self.executed), ('pending', 0, []))
        self.assertEqual(record.event_ids.mapped('kind'), ['submitted', 'execution_failed'])
        self.assertEqual(self._statuses(record), ['pending'])
        self.fail_execution = False
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertEqual(record.state, 'done')

    def test_a_failing_rejection_effect_keeps_the_request_pending(self):
        record = self.pending_request(self.published_process(kind=KIND))
        self.fail_execution = True
        self._fails(record.with_user(self.reviewer).action_reject, record.revision, 'No')
        record.invalidate_recordset()
        self.assertEqual((record.state, record.event_ids.mapped('kind')), ('pending', ['submitted', 'execution_failed']))

    def test_an_execution_kind_without_its_application_cannot_be_executed(self):
        record = self.pending_request(self.published_process(kind=KIND))
        self.real_execution = True
        with self.assertRaisesRegex(OperationExecutionError, 'not available'):
            record.with_user(self.reviewer).action_approve(record.revision)
        record.invalidate_recordset()
        self.assertEqual((record.state, record.execution_count), ('pending', 0))


class TestWithdrawAndClose(ApprovalCase):

    def test_the_requester_withdraws_an_open_request_in_any_open_state(self):
        process = self.published_process()
        draft = self.draft_request(process)
        draft.with_user(self.requester).action_withdraw(draft.revision, 'Changed my mind')
        self.assertEqual((draft.state, draft.event_ids.mapped('kind'), draft.event_ids.comment), ('withdrawn', ['withdrawn'], 'Changed my mind'))
        pending = self.pending_request(process)
        pending.with_user(self.requester).action_withdraw(pending.revision)
        self.assertEqual(pending.state, 'withdrawn')
        returned = self.pending_request(process)
        returned.with_user(self.reviewer).action_return(returned.revision, 'Fix')
        returned.with_user(self.requester).action_withdraw(returned.revision)
        self.assertEqual(returned.state, 'withdrawn')

    def test_only_the_requester_withdraws_and_never_a_closed_request(self):
        record = self.pending_request()
        for user in (self.reviewer, self.manager, self.bystander):
            with self.assertRaises(AccessError):
                record.with_user(user).action_withdraw(record.revision)
        with self.assertRaises(LiwanAccessRule):
            record.with_user(self.requester).action_withdraw(record.revision + 1)
        record.with_user(self.reviewer).action_approve(record.revision)
        with self.assertRaisesRegex(AccessError, 'open request'):
            record.with_user(self.requester).action_withdraw(record.revision)
        self.assertEqual(record.state, 'done')

    def test_a_withdrawn_request_cannot_be_decided_or_resubmitted(self):
        record = self.pending_request()
        record.with_user(self.requester).action_withdraw(record.revision)
        with self.assertRaises(AccessError):
            record.with_user(self.reviewer).action_approve(record.revision)
        with self.assertRaises(AccessError):
            record.with_user(self.requester).action_submit(record.revision)

    def test_only_the_owning_application_closes_a_request_externally(self):
        record = self.pending_request()
        with self.assertRaisesRegex(AccessError, 'owning application'):
            record.with_user(self.manager)._operations_close_externally('Decided elsewhere')
        with self.assertRaises(AccessError):
            record.with_user(self.manager).with_context(operations_external_close=object())._operations_close_externally('Decided elsewhere')
        closer = record.with_user(self.manager).with_context(operations_external_close=EXTERNAL_CLOSE)
        closer._operations_close_externally('Decided elsewhere')
        self.assertEqual(record.state, 'withdrawn')
        self.assertEqual((record.event_ids[-1].kind, record.event_ids[-1].comment), ('closed_externally', 'Decided elsewhere'))
        events = len(record.event_ids)
        closer._operations_close_externally('Again')
        self.assertEqual(len(record.event_ids), events)

    def test_a_finished_request_is_not_closed_externally(self):
        record = self.pending_request()
        record.with_user(self.reviewer).action_approve(record.revision)
        record.with_user(self.manager).with_context(operations_external_close=EXTERNAL_CLOSE)._operations_close_externally('Late')
        self.assertEqual((record.state, record.event_ids.mapped('kind')), ('done', ['submitted', 'approved', 'executed']))


class TestEngineGuards(ApprovalCase):

    def test_the_generic_tier_validation_buttons_are_closed(self):
        record = self.pending_request()
        for user in (self.requester, self.reviewer, self.manager):
            target = record.with_user(user)
            for call in (target.request_validation, target.validate_tier, target.reject_tier, target.restart_validation,
                         target._validate_tier, target._rejected_tier):
                with self.assertRaises(AccessError):
                    call()
        self.assertEqual((record.state, record.revision), ('pending', 1))

    def test_audit_events_are_server_controlled_and_immutable(self):
        record = self.pending_request()
        event = record.event_ids
        Event = self.env['liwan.operation.event']
        for user in (self.requester, self.reviewer, self.manager):
            with self.assertRaises(AccessError):
                Event.with_user(user).create({'request_id': record.id, 'company_id': self.company.id, 'kind': 'forged', 'actor_id': user.id, 'cycle': 1})
            with self.assertRaises(AccessError):
                event.with_user(user).write({'comment': 'Edited'})
            with self.assertRaises(AccessError):
                event.with_user(user).unlink()
        with self.assertRaises(AccessError):
            event.write({'comment': 'Edited'})
        with self.assertRaises(AccessError):
            event.unlink()

    def test_the_allowed_actions_follow_state_role_and_feature(self):
        record = self.pending_request()

        def actions(user):
            return record.with_user(user)._operations_allowed_actions()

        self.assertEqual(actions(self.requester), {'edit': False, 'submit': False, 'approve': False, 'reject': False, 'return': False, 'withdraw': True})
        self.assertEqual(actions(self.reviewer), {'edit': False, 'submit': False, 'approve': True, 'reject': True, 'return': True, 'withdraw': False})
        self.assertFalse(any(actions(self.bystander).values()))
        draft = self.draft_request(self.published_process())
        self.assertEqual(draft.with_user(self.requester)._operations_allowed_actions(), {'edit': True, 'submit': True, 'approve': False, 'reject': False, 'return': False, 'withdraw': True})
        record.with_user(self.reviewer).action_approve(record.revision)
        self.assertFalse(any(actions(self.requester).values()) or any(actions(self.reviewer).values()))
