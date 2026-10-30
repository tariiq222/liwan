# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo.tests import new_test_user

from .common import LiwanHrCase


class LeaveCancellationCase(LiwanHrCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='leave_cancel_manager', password='leave_cancel_manager_pass_123', groups='liwan_core.group_employee', name='Cancellation manager')
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id, 'company_id': cls.env.company.id,
        }])
        cls.staff = cls.env['hr.employee'].create({'name': 'Cancellation employee', 'user_id': cls.employee.id, 'company_id': cls.env.company.id})
        cls.manager_employee = cls.env['hr.employee'].create({'name': 'Manager employee', 'user_id': cls.manager.id, 'company_id': cls.env.company.id})
        cls.kind = cls.env['hr.leave.type'].create({'name': 'Cancellation test', 'requires_allocation': False, 'leave_validation_type': 'hr', 'work_entry_type_id': cls.env.ref('hr_work_entry.work_entry_type_leave').id})
        day = date.today() + timedelta(days=30)
        cls.monday = day + timedelta(days=(0 - day.weekday()) % 7)

    def _user_with_leave_role(self, login, name, capability_keys):
        user = new_test_user(self.env, login=login, password=login + '_pass_123', name=name, groups='base.group_user')
        role = self.env['liwan.access.role'].create({'key': login, 'name_ar': name, 'name_en': name, 'type': 'custom', 'assignable': True, 'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', 'in', capability_keys)]).ids)]})
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': self.env.company.id}])
        return user

    def _approved_leave(self, employee=None):
        leave = self.env['hr.leave'].create({'employee_id': (employee or self.staff).id, 'holiday_status_id': self.kind.id, 'request_date_from': self.monday, 'request_date_to': self.monday})
        leave.action_approve()
        return leave

    def _model(self, user=None):
        return self.env['liwan.hr.leave.cancellation'].with_user(user or self.employee).with_context(allowed_company_ids=[self.env.company.id])

    def _as_manager(self):
        self.authenticate(self.manager.login, 'leave_cancel_manager_pass_123')

    def _as_staff(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
