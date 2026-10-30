# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_operations.models.notification_types import KINDS


@tagged('post_install', '-at_install', 'liwan')
class TestOperationsBell(LiwanApiCase):
    """OPS-15 and OPS-201: reviewers and requesters are told through the bell, always."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        service = cls.env['liwan.access.service']
        company = cls.env.company
        cls.manager = new_test_user(cls.env, login='opsb_manager', password='opsb_manager_pass_123', groups='liwan_core.group_employee')
        cls.reviewers = [
            new_test_user(cls.env, login=f'opsb_reviewer_{i}', password=f'opsb_reviewer_{i}_pass_123', groups='liwan_core.group_employee')
            for i in (1, 2)
        ]
        service._liwan_replace_assignments(cls.employee, [{'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': company.id}])
        for user, role in [(cls.manager, 'manager'), *[(u, 'reviewer') for u in cls.reviewers]]:
            service._liwan_replace_assignments(user, [{'role_id': cls.env.ref(f'liwan_operations.role_operations_{role}').id, 'company_id': company.id}])
        cls.process = cls.env['liwan.operation.process'].with_user(cls.manager).create({'name': 'Expense approval'})
        cls.process.with_user(cls.manager).action_configure(0, 'Expense approval', 'Two stages', 'approval', [
            {'name': 'Review', 'reviewer_ids': [cls.reviewers[0].id]},
            {'name': 'Approve', 'reviewer_ids': [cls.reviewers[1].id]},
        ])
        cls.process.with_user(cls.manager).action_publish(1)

    def _pending(self):
        record = self.env['liwan.operation.request'].with_user(self.employee).create({
            'name': 'Laptop request', 'description': 'Needed', 'process_id': self.process.id,
        })
        record.action_submit(0)
        return record

    def _bell(self, user, *kinds):
        return self.env['mail.message'].search([
            ('liwan_notification_kind', 'in', kinds or KINDS), ('partner_ids', 'in', user.partner_id.ids),
        ])

    def _all(self):
        return self.env['mail.message'].search_count([('liwan_notification_kind', 'in', KINDS)])

    def _api_rows(self, login):
        self.authenticate(login, f'{login}_pass_123')
        items = self.api('GET', '/api/v1/notifications').json()['items']
        return [item for item in items if item['kind'] in KINDS]

    def test_first_stage_reviewer_is_told_on_submit_and_only_them(self):
        record = self._pending()
        self.assertEqual(self._bell(self.reviewers[0]).mapped('liwan_notification_kind'), ['operations.review_requested'])
        self.assertFalse(self._bell(self.reviewers[1]))
        self.assertFalse(self._bell(self.employee))
        self.assertEqual(self._all(), 1)
        rows = self._api_rows('opsb_reviewer_1')
        self.assertEqual([(r['kind'], r['request_id'], r['title'], r['is_read']) for r in rows],
                         [('operations.review_requested', record.id, 'Laptop request', False)])
        self.assertEqual(self._api_rows('opsb_reviewer_2'), [])
        self.assertEqual(self._api_rows('api_emp'), [])

    def test_next_stage_reviewer_is_told_when_it_is_their_turn(self):
        record = self._pending()
        record.with_user(self.reviewers[0]).action_approve(record.revision)
        self.assertEqual(self._bell(self.reviewers[1]).mapped('liwan_notification_kind'), ['operations.review_requested'])
        self.assertFalse(self._bell(self.employee))
        self.assertEqual([r['request_id'] for r in self._api_rows('opsb_reviewer_2')], [record.id])

    def test_final_approval_tells_the_requester(self):
        record = self._pending()
        record.with_user(self.reviewers[0]).action_approve(record.revision)
        record.with_user(self.reviewers[1]).action_approve(record.revision)
        self.assertEqual(record.state, 'done')
        self.assertEqual(self._bell(self.employee).mapped('liwan_notification_kind'), ['operations.approved'])
        self.assertFalse(self._bell(self.reviewers[1], 'operations.approved'))
        rows = self._api_rows('api_emp')
        self.assertEqual([(r['kind'], r['request_id']) for r in rows], [('operations.approved', record.id)])

    def test_rejection_and_return_tell_the_requester(self):
        rejected = self._pending()
        rejected.with_user(self.reviewers[0]).action_reject(rejected.revision, 'Too expensive')
        returned = self._pending()
        returned.with_user(self.reviewers[0]).action_return(returned.revision, 'More details')
        by_request = {(r['request_id']): r['kind'] for r in self._api_rows('api_emp')}
        self.assertEqual(by_request, {rejected.id: 'operations.rejected', returned.id: 'operations.returned'})
        self.assertFalse(self._bell(self.reviewers[0], 'operations.rejected', 'operations.returned'))

    def test_resubmission_after_return_tells_the_reviewer_again(self):
        record = self._pending()
        record.with_user(self.reviewers[0]).action_return(record.revision, 'More details')
        record.with_user(self.employee).action_submit(record.revision)
        self.assertEqual(len(self._bell(self.reviewers[0], 'operations.review_requested')), 2)

    def test_a_retried_transition_adds_no_second_row(self):
        record = self._pending()
        stale = record.revision
        record.with_user(self.reviewers[0]).action_return(stale, 'More details')
        with self.assertRaises(LiwanAccessRule):
            record.with_user(self.reviewers[0]).action_return(stale, 'More details')
        with self.assertRaises(AccessError):
            record.with_user(self.reviewers[0]).action_return(record.revision, 'More details')
        record.with_user(self.reviewers[0])._notify_requester()
        self.assertEqual(len(self._bell(self.employee, 'operations.returned')), 1)
        self.assertEqual(len(self._bell(self.reviewers[0], 'operations.review_requested')), 1)

    def _same_reviewer_twice(self, mode):
        both = self.env['liwan.operation.process'].with_user(self.manager).create({'name': f'Same reviewer twice {mode}'})
        both.with_user(self.manager).action_configure(0, f'Same reviewer twice {mode}', '', 'approval', [
            {'name': 'First', 'reviewer_ids': [self.reviewers[0].id]},
            {'name': 'Second', 'reviewer_ids': [self.reviewers[0].id, self.reviewers[1].id]},
        ], stage_approval_mode=mode)
        both.with_user(self.manager).action_publish(1)
        record = self.env['liwan.operation.request'].with_user(self.employee).create({'name': f'Twice {mode}', 'process_id': both.id})
        record.action_submit(0)
        self.assertFalse(self._bell(self.employee))
        record.with_user(self.reviewers[0]).action_approve(record.revision)
        return record

    def test_the_actor_is_never_notified_of_their_own_action(self):
        record = self._same_reviewer_twice('per_stage')
        # Each stage needs its own decision: the request waits at the second stage, its other reviewer is asked,
        # and the reviewer who just approved is not notified of their own action.
        self.assertEqual(record.state, 'pending')
        self.assertEqual(self._bell(self.reviewers[0]).mapped('liwan_notification_kind'), ['operations.review_requested'])
        self.assertEqual(self._bell(self.reviewers[1]).mapped('liwan_notification_kind'), ['operations.review_requested'])
        self.assertFalse(self._bell(self.employee))

    def test_single_approval_mode_decides_without_asking_again(self):
        record = self._same_reviewer_twice('single')
        # One reviewer's approval passes both stages, so the request is decided and nobody is asked again.
        self.assertEqual(record.state, 'done')
        self.assertEqual(self._bell(self.reviewers[0]).mapped('liwan_notification_kind'), ['operations.review_requested'])
        self.assertFalse(self._bell(self.reviewers[1]))
        self.assertEqual(self._bell(self.employee).mapped('liwan_notification_kind'), ['operations.approved'])
