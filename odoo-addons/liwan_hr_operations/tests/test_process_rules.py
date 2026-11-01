# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import (
    LEAVES,
    STAGE_MANAGER,
    STAGE_OFFICERS,
    LeaveApprovalCase,
    next_monday,
)
from odoo.addons.liwan_hr_operations.models.common import KIND


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

    def _edit_process(self):
        process = self.process.with_user(self.ops_admin)
        process.action_configure(process.revision, process.name, '', KIND, [STAGE_MANAGER, STAGE_OFFICERS], purpose='employee')
        return process

    def test_a_leave_is_refused_while_the_process_is_being_edited(self):
        process = self._edit_process()
        self.assertEqual(process.state, 'draft')
        self.login_as(self.employee)
        before = self.env['hr.leave'].search_count([])
        start = next_monday(0)
        payload = {'leave_type_id': self.annual.id, 'date_from': start.isoformat(), 'date_to': start.isoformat(), 'notes': ''}
        response = self.api('POST', LEAVES, json=payload)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.env['hr.leave'].search_count([]), before)
        process.action_publish(process.revision)
        self.assertEqual(self.api('POST', LEAVES, json=payload).status_code, 201)

    def test_publishing_takes_the_company_lock_before_counting_published_processes(self):
        process = self._edit_process()
        company = type(self.env.company)
        with patch.object(company, 'lock_for_update', autospec=True, side_effect=company.lock_for_update) as lock:
            process.action_publish(process.revision)
        self.assertIn(self.env.company.id, [call.args[0].id for call in lock.call_args_list])
