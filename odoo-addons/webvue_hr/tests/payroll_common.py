# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import new_test_user

from .common import WebVueHrCase


class PayrollCase(WebVueHrCase):
    """Fixtures shared by the payroll tests: users holding chosen capabilities, employees
    with a contract start and nationality, and compensation records."""

    def payroll_user(self, login, keys):
        """A user whose only access is the given capabilities, in the current company."""
        user = new_test_user(
            self.env, login=login, password=f'{login}_pass_123', name=login,
            groups='webvue_core.group_employee',
        )
        role = self.env['webvue.access.role'].create({
            'key': f'payroll_{login}', 'name_ar': login, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', list(keys)),
            ]).ids)],
        })
        self.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.env.company.id,
        }])
        return user

    def make_employee(self, name, *, country='SA', start=date(2024, 1, 1), department=None, user=None):
        vals = {'name': name, 'company_id': self.env.company.id}
        if department:
            vals['department_id'] = department.id
        if user:
            vals['user_id'] = user.id
        employee = self.env['hr.employee'].create(vals)
        employee.version_id.write({
            'contract_date_start': start,
            'country_id': self.env.ref(f'base.{country.lower()}').id,
        })
        return employee

    def set_compensation(
        self, employee, basic, housing=0, transport=0, other=0, iban=None, gosi_registration_date=None,
    ):
        return self.env['webvue.hr.compensation'].create({
            'employee_id': employee.id,
            'basic_wage': basic,
            'housing_allowance': housing,
            'transport_allowance': transport,
            'other_allowance': other,
            'iban': iban or False,
            'gosi_registration_date': gosi_registration_date or False,
        })
