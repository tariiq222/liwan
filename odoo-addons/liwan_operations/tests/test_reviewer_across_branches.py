# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The reviewer filter of a submission when a candidate also belongs to a company the requester cannot see."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import WorkingCompanyCase


@tagged('post_install', '-at_install', 'liwan')
class TestReviewerAcrossBranches(WorkingCompanyCase):
    """``self.company_id in u.company_ids`` on a candidate who is a member of two sibling branches."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        manager_role = cls.env.ref('liwan_operations.role_operations_manager')
        reviewer_role = cls.env.ref('liwan_operations.role_operations_reviewer')
        cls.ops_manager = cls._member('ops_manager', cls.branch_a, [cls.branch_a], {cls.branch_a: manager_role})
        cls.ops_requester = cls._member('ops_requester', cls.branch_a, [cls.branch_a], {cls.branch_a: cls.employee_role})
        cls.ops_approver = cls._member(
            'ops_approver', cls.root_company, [cls.root_company, cls.branch_a],
            {cls.root_company: manager_role, cls.branch_a: manager_role},
        )
        cls.ops_reviewer = cls._member(
            'ops_reviewer', cls.branch_a, [cls.branch_a, cls.branch_b],
            {cls.branch_a: reviewer_role, cls.branch_b: reviewer_role},
        )

    def test_a_reviewer_who_belongs_to_a_sibling_branch_too_is_still_eligible(self):
        process = self.env['liwan.operation.process'].with_user(self.ops_manager).create({'name': 'Across branches'})
        process.action_configure(0, 'Across branches', '', 'approval', [
            {'name': 'Reviewed', 'reviewer_ids': [self.ops_reviewer.id]},
        ], purpose='employee')
        process.action_publish(1)
        request = self.env['liwan.operation.request'].with_user(self.ops_requester).create({
            'name': 'Needs a reviewer', 'process_id': process.id,
        })
        self.assertEqual(request.company_id, self.branch_a)
        request.action_submit(0)
        self.assertEqual(request.stage_snapshot[0]['reviewer_ids'], [self.ops_reviewer.id])
        self.assertEqual(request.state, 'pending')

    def test_the_review_resolution_of_a_pending_request_keeps_the_reviewer_from_the_sibling_branch(self):
        process = self.env['liwan.operation.process'].with_user(self.ops_manager).create({'name': 'Across branches 2'})
        process.action_configure(0, 'Across branches 2', '', 'approval', [
            {'name': 'Reviewed', 'reviewer_ids': [self.ops_reviewer.id]},
        ], purpose='employee')
        process.action_publish(1)
        request = self.env['liwan.operation.request'].with_user(self.ops_requester).create({
            'name': 'Needs a reviewer too', 'process_id': process.id,
        })
        request.action_submit(0)
        review = request.with_user(self.ops_requester).review_ids
        self.assertEqual(review._get_reviewers(), self.ops_reviewer)

    def test_an_approver_homed_in_the_root_still_finds_the_reviewers_of_a_branch_document(self):
        process = self.env['liwan.operation.process'].with_user(self.ops_manager).create({'name': 'Root approver'})
        process.action_configure(0, 'Root approver', '', 'approval', [
            {'name': 'Reviewed', 'reviewer_ids': [self.ops_reviewer.id]},
        ], purpose='employee')
        process.action_publish(1)
        request = self.env['liwan.operation.request'].with_user(self.ops_requester).create({
            'name': 'Seen from the root', 'process_id': process.id,
        })
        request.action_submit(0)
        as_approver = request.with_user(self.ops_approver).with_company(self.branch_a)
        self.assertEqual(as_approver.review_ids._get_reviewers(), self.ops_reviewer)
