# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase


@tagged('post_install', '-at_install', 'webvue')
class TestLeaveAllocationControls(WebVueHrCase):
    """A leave manager grants days to others, approved at once, never to themselves."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        company.country_id = cls.env.ref('base.sa')
        cls.annual = cls.env.ref('hr_holidays.leave_type_paid_time_off')
        cls.manager, cls.manager_employee = cls._leave_manager('alloc_mgr', 'Allocation Manager')
        cls.peer, cls.peer_employee = cls._leave_manager('alloc_peer', 'Allocation Peer')
        cls.staff = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1) or \
            cls.env['hr.employee'].create({
                'name': cls.employee.name, 'user_id': cls.employee.id, 'company_id': company.id,
            })
        cls.no_account = cls.env['hr.employee'].create({
            'name': 'Allocation Without Account', 'company_id': company.id,
        })

    @classmethod
    def _leave_manager(cls, login, name):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.env.company.id,
        }])
        employee = cls.env['hr.employee'].create({
            'name': name, 'user_id': user.id, 'company_id': cls.env.company.id,
        })
        return user, employee

    def _grant(self, employee, days=5):
        return self.api('POST', '/api/v1/hr/leave/allocations', json={
            'employee_id': employee.id, 'leave_type_id': self.annual.id,
            'number_of_days': days, 'date_from': date.today().isoformat(),
        })

    def _allocations(self, employee):
        return self.env['hr.leave.allocation'].search_count([('employee_id', '=', employee.id)])

    def test_manager_cannot_grant_days_to_their_own_employee_record(self):
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self._grant(self.manager_employee, days=30)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'forbidden')
        self.assertEqual(self._allocations(self.manager_employee), 0)

    def test_another_manager_grants_the_first_manager_and_it_is_approved_at_once(self):
        self.authenticate('alloc_peer', 'alloc_peer_pass_123')
        res = self._grant(self.manager_employee)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['state'], 'validate')
        self.assertEqual(self._allocations(self.manager_employee), 1)

    def test_manager_grants_an_ordinary_employee(self):
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self._grant(self.staff)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['state'], 'validate')

    def test_manager_grants_an_employee_without_an_account(self):
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self._grant(self.no_account)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['state'], 'validate')

    def test_employee_without_manage_capability_cannot_grant_even_to_themselves(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for employee in (self.staff, self.no_account):
            res = self._grant(employee, days=99)
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(self._allocations(employee), 0)
