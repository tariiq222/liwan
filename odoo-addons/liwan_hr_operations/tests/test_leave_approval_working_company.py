# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The approval status of a person's own leave is read in the home company while the session works in another."""
from datetime import date, timedelta

from odoo.fields import Command
from odoo.tests import tagged

from .common import LEAVES, next_monday
from odoo.addons.liwan_api.tests.common import WorkingCompanyCase
from odoo.addons.liwan_hr.tests.common import set_hr_feature
from odoo.addons.liwan_hr_operations.models.common import BRIDGE, BRIDGE_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestOwnApprovalFollowsTheHomeCompany(WorkingCompanyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for feature in ('hr.enabled', 'operations.enabled'):
            set_hr_feature(cls, feature)
        cls.annual = cls.env.ref('hr_holidays.leave_type_paid_time_off')
        cls.annual.leave_validation_type = 'both'
        cls.branch_a.country_id = cls.env.ref('base.sa')
        cls.branch_a._hr_leave_seed_default_process()
        cls.direct_manager = cls._member('wc_ap_manager', cls.branch_a, [cls.branch_a], {cls.branch_a: cls.employee_role})
        cls.worker = cls._staff('wc_ap_worker', cls.employee_role)
        cls.colleague = cls._staff('wc_ap_colleague', cls.employee_role)
        cls.hr_user = cls._staff('wc_ap_hr', cls.env.ref('liwan_hr.role_hr_manager'))

    @classmethod
    def _staff(cls, login, role):
        user = cls._member(login, cls.branch_a, [cls.branch_a, cls.branch_b], {cls.branch_a: role, cls.branch_b: cls.employee_role})
        employee = cls.env['hr.employee'].create({'name': login, 'user_id': user.id, 'company_id': cls.branch_a.id})
        employee.leave_manager_id = cls.direct_manager
        cls.env['hr.leave.allocation'].create({
            'employee_id': employee.id, 'holiday_status_id': cls.annual.id, 'number_of_days': 30,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()
        return user

    def _file(self, user, weeks):
        """A leave of ``user`` in the home company with its approval request."""
        start = next_monday(weeks)
        employee = self.env['hr.employee'].search([('user_id', '=', user.id), ('company_id', '=', self.branch_a.id)])
        leave = self.env['hr.leave'].with_company(self.branch_a).create({
            'employee_id': employee.id, 'holiday_status_id': self.annual.id,
            'request_date_from': start, 'request_date_to': start + timedelta(days=1), 'name': 'Trip',
        })
        # The request is made without submitting it: choosing the approvers reads every candidate's companies,
        # which no officer of the branch may do, and this test is about who can read the status afterwards.
        process = self.env['liwan.operation.process']._hr_leave_governing_process(self.branch_a)
        request = self.env['liwan.operation.request'].with_company(self.branch_a).with_context(**{BRIDGE_CONTEXT: BRIDGE}).create({
            'name': 'Leave request', 'process_id': process.id, 'target_id': leave.id,
        })
        request._ops_write({'participant_ids': [Command.link(user.id)]})
        self.assertEqual(leave.company_id, self.branch_a)
        leave.invalidate_recordset()
        self.assertEqual(leave.liwan_approval_request_ids, request)
        return leave

    def test_the_own_approval_status_is_read_from_the_working_company_with_the_marker(self):
        leave = self._file(self.worker, 0)
        self.sign_in('wc_ap_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        status = f'{LEAVES}/{leave.id}/approval'
        opened = self.api('GET', f'{status}?mine=1')
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(self.api('GET', status).status_code, 404)

    def test_the_marker_never_reaches_a_colleagues_approval(self):
        leave = self._file(self.colleague, 1)
        status = f'{LEAVES}/{leave.id}/approval'
        self.sign_in('wc_ap_hr')
        self.assertEqual(self.api('GET', status).status_code, 200)
        self.assertEqual(self.api('GET', f'{status}?mine=1').status_code, 404)
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.assertEqual(self.api('GET', f'{status}?mine=1').status_code, 404)
