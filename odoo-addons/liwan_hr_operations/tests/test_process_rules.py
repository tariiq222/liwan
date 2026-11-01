# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import STAGE_MANAGER, STAGE_OFFICERS, LeaveApprovalCase


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveProcessRules(LeaveApprovalCase):

    def test_a_second_published_process_is_refused(self):
        with self.assertRaises(ValidationError):
            self.publish_process([STAGE_MANAGER, STAGE_OFFICERS])

    def test_the_final_stage_must_be_the_officers(self):
        self.archive_process()
        with self.assertRaises(ValidationError):
            self.publish_process([STAGE_OFFICERS, STAGE_MANAGER])
        with self.assertRaises(ValidationError):
            self.publish_process([STAGE_MANAGER])

    def test_named_reviewers_must_be_able_to_approve_leave(self):
        self.archive_process()
        reviewer = self._user('lao_rev', 'Reviewer', ['liwan_core.role_employee', 'liwan_operations.role_operations_reviewer'])
        with self.assertRaises(ValidationError):
            self.publish_process([{'name': 'Named', 'reviewer_ids': [reviewer.id]}])
        officer = self._user('lao_off2', 'Officer Two', ['liwan_core.role_employee', 'liwan_hr.role_hr_manager', 'liwan_operations.role_operations_reviewer'])
        process = self.publish_process([STAGE_MANAGER, {'name': 'Named', 'reviewer_ids': [officer.id]}])
        self.assertEqual(process.state, 'published')

    def test_the_process_is_an_employee_affairs_process(self):
        self.archive_process()
        with self.assertRaises(ValidationError):
            self.publish_process([STAGE_MANAGER, STAGE_OFFICERS], purpose='work')

    def test_the_kind_is_hidden_from_the_self_service_forms(self):
        self.assertIn('hr_leave', self.env['liwan.operation.process']._operations_application_kinds())
