# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase

LEAVE_KEYS = {
    'id', 'employee', 'leave_type', 'date_from', 'date_to', 'number_of_days',
    'state', 'notes', 'can_approve', 'can_refuse', 'can_cancel',
}
BALANCE_KEYS = {'leave_type', 'allocated', 'taken', 'pending', 'remaining'}


def _next_weekday(start, weekday):
    return start + timedelta(days=(weekday - start.weekday()) % 7 or 7)


@tagged('post_install', '-at_install', 'webvue')
class TestHrLeave(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        company.country_id = cls.env.ref('base.sa')
        cls.manager = new_test_user(
            cls.env, login='hr_leave_mgr', password='hr_leave_mgr_pass_123',
            name='Leave Manager', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': company.id,
        }])
        cls.manager_employee = cls.env['hr.employee'].create({
            'name': 'Leave Manager', 'user_id': cls.manager.id, 'company_id': company.id,
        })
        cls.staff = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1) or \
            cls.env['hr.employee'].create({
                'name': cls.employee.name, 'user_id': cls.employee.id, 'company_id': company.id,
            })
        cls.other = new_test_user(
            cls.env, login='hr_leave_other', password='hr_leave_other_pass_123',
            name='Other Staff', groups='webvue_core.group_employee',
        )
        cls.other_employee = cls.env['hr.employee'].create({
            'name': 'Other Staff', 'user_id': cls.other.id, 'company_id': company.id,
        })
        cls.annual = cls.env.ref('hr_holidays.leave_type_paid_time_off')
        cls.sick = cls.env.ref('hr_holidays.l10n_sa_leave_type_sick_leave_0')
        cls.monday = _next_weekday(date.today() + timedelta(days=14), 0)
        cls.env['hr.leave.allocation'].create({
            'employee_id': cls.staff.id,
            'holiday_status_id': cls.annual.id,
            'number_of_days': 21,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()

    def _as_staff(self):
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _as_manager(self):
        self.authenticate('hr_leave_mgr', 'hr_leave_mgr_pass_123')

    def _request(self, days=2, leave_type=None):
        return self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': (leave_type or self.annual).id,
            'date_from': self.monday.isoformat(),
            'date_to': (self.monday + timedelta(days=days - 1)).isoformat(),
            'notes': 'Family trip',
        })

    def test_saudi_event_leaves_need_no_balance_and_all_name_a_work_entry_type(self):
        saudi = self.env['hr.leave.type'].search([('country_id', '=', self.env.ref('base.sa').id)])
        self.assertEqual(len(saudi), 10)
        self.assertTrue(all(saudi.mapped('work_entry_type_id')), saudi.filtered(lambda t: not t.work_entry_type_id).mapped('name'))
        balanced = saudi.filtered('requires_allocation')
        self.assertEqual(balanced, self.env.ref('hr_holidays.l10n_sa_leave_type_sick_leave_100') | self.env.ref('hr_holidays.l10n_sa_leave_type_sick_leave_75'))

    def test_employee_lists_leave_types_of_their_country(self):
        self._as_staff()
        res = self.api('GET', '/api/v1/hr/leave/types')
        self.assertEqual(res.status_code, 200)
        ids = {item['id'] for item in res.json()['items']}
        self.assertIn(self.annual.id, ids)
        self.assertIn(self.env.ref('hr_holidays.l10n_sa_leave_type_hajj').id, ids)
        self.assertNotIn(self.env.ref('hr_holidays.l10n_be_leave_type_maternity').id, ids)

    def test_balances_list_only_types_with_an_allocation(self):
        self._as_staff()
        items = self.api('GET', '/api/v1/hr/leave/balances').json()['items']
        self.assertEqual([item['leave_type']['id'] for item in items], [self.annual.id])

    def test_employee_requests_leave_and_balance_reflects_it(self):
        self._as_staff()
        res = self._request(days=2)
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(set(body), LEAVE_KEYS)
        self.assertEqual(body['employee']['id'], self.staff.id)
        self.assertEqual(body['state'], 'confirm')
        self.assertEqual(body['number_of_days'], 2)
        self.assertFalse(body['can_approve'])
        balances = self.api('GET', '/api/v1/hr/leave/balances').json()['items']
        annual = next(b for b in balances if b['leave_type']['id'] == self.annual.id)
        self.assertEqual(set(annual), BALANCE_KEYS)
        self.assertEqual(annual['allocated'], 21)
        self.assertEqual(annual['pending'], 2)
        self.assertEqual(annual['remaining'], 19)

    def test_employee_cannot_approve(self):
        self._as_staff()
        leave_id = self._request().json()['id']
        res = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/approve', json={})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_employee_sees_only_own_requests(self):
        self.env['hr.leave'].create({
            'employee_id': self.other_employee.id,
            'holiday_status_id': self.sick.id,
            'request_date_from': self.monday,
            'request_date_to': self.monday,
        })
        self._as_staff()
        self._request()
        items = self.api('GET', '/api/v1/hr/leave/requests').json()['items']
        self.assertTrue(items)
        self.assertEqual({item['employee']['id'] for item in items}, {self.staff.id})

    def test_employee_cannot_request_for_someone_else(self):
        self._as_staff()
        res = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.sick.id,
            'employee_id': self.other_employee.id,
            'date_from': self.monday.isoformat(),
            'date_to': self.monday.isoformat(),
        })
        self.assertEqual(res.status_code, 403)

    def test_manager_approves_and_refuses(self):
        self._as_staff()
        first = self._request(days=1).json()['id']
        self._as_manager()
        listed = self.api('GET', '/api/v1/hr/leave/requests?state=confirm').json()['items']
        self.assertIn(first, {item['id'] for item in listed})
        detail = self.api('GET', f'/api/v1/hr/leave/requests/{first}').json()
        self.assertTrue(detail['can_approve'])
        res = self.api('POST', f'/api/v1/hr/leave/requests/{first}/approve', json={})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'validate')
        refused = self.api('POST', f'/api/v1/hr/leave/requests/{first}/refuse', json={})
        self.assertEqual(refused.json()['state'], 'refuse')

    def test_employee_cancels_own_approved_leave(self):
        self._as_staff()
        leave_id = self._request(days=1).json()['id']
        self.env['hr.leave'].browse(leave_id).action_approve()
        res = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/cancel', json={'reason': 'Plans changed'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'cancel')

    def test_manager_allocates_days(self):
        self._as_manager()
        res = self.api('POST', '/api/v1/hr/leave/allocations', json={
            'employee_id': self.other_employee.id,
            'leave_type_id': self.annual.id,
            'number_of_days': 30,
            'date_from': date.today().replace(month=1, day=1).isoformat(),
        })
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['state'], 'validate')
        balances = self.api('GET', f'/api/v1/hr/leave/balances?employee_id={self.other_employee.id}').json()['items']
        annual = next(b for b in balances if b['leave_type']['id'] == self.annual.id)
        self.assertEqual(annual['remaining'], 30)

    def test_allocation_needs_manage_capability(self):
        self._as_staff()
        res = self.api('POST', '/api/v1/hr/leave/allocations', json={
            'employee_id': self.staff.id, 'leave_type_id': self.annual.id,
            'number_of_days': 99, 'date_from': date.today().isoformat(),
        })
        self.assertEqual(res.status_code, 403)

    def test_allocation_rejects_a_type_without_allocations(self):
        self._as_manager()
        res = self.api('POST', '/api/v1/hr/leave/allocations', json={
            'employee_id': self.staff.id, 'leave_type_id': self.sick.id,
            'number_of_days': 5, 'date_from': date.today().isoformat(),
        })
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'leave_type_id')

    def test_request_validation(self):
        self._as_staff()
        res = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.annual.id,
            'date_from': self.monday.isoformat(),
            'date_to': (self.monday - timedelta(days=1)).isoformat(),
        })
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'date_to')
        unknown = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.annual.id, 'date_from': self.monday.isoformat(),
            'date_to': self.monday.isoformat(), 'state': 'validate',
        })
        self.assertEqual(unknown.status_code, 422)
        self.assertEqual(unknown.json()['field'], 'state')

    def test_employee_cannot_read_or_cancel_another_employees_request(self):
        other_leave = self.env['hr.leave'].create({
            'employee_id': self.other_employee.id,
            'holiday_status_id': self.sick.id,
            'request_date_from': self.monday,
            'request_date_to': self.monday,
        })
        self._as_staff()
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/requests/{other_leave.id}').status_code, 404)
        self.assertEqual(self.api('POST', f'/api/v1/hr/leave/requests/{other_leave.id}/cancel', json={}).status_code, 404)
        self.assertEqual(other_leave.state, 'confirm')

    def test_employee_balance_of_someone_else_is_forbidden(self):
        self._as_staff()
        res = self.api('GET', f'/api/v1/hr/leave/balances?employee_id={self.other_employee.id}')
        self.assertEqual(res.status_code, 403)

    def test_approver_capability_grants_exactly_the_time_off_officer_group(self):
        implied = self.env.ref('webvue_hr.group_cap_hr_leave_approve').all_implied_ids
        self.assertIn(self.env.ref('hr_holidays.group_hr_holidays_user'), implied)
        self.assertIn(self.env.ref('hr.group_hr_user'), implied)
        self.assertNotIn(self.env.ref('hr.group_hr_manager'), implied)
        self.assertNotIn(self.env.ref('hr_holidays.group_hr_holidays_manager'), implied)

    def test_unknown_request_is_not_found(self):
        self._as_manager()
        res = self.api('GET', '/api/v1/hr/leave/requests/999999')
        self.assertEqual(res.status_code, 404)

    def test_leave_capabilities_never_grant_payroll_or_time_off_manager(self):
        for xmlid in ('webvue_hr.group_cap_hr_leave_approve', 'webvue_hr.group_cap_hr_leave_manage'):
            implied = self.env.ref(xmlid).all_implied_ids
            self.assertNotIn(self.env.ref('hr_holidays.group_hr_holidays_manager'), implied)
            self.assertFalse(implied.filtered(lambda g: 'payroll' in (g.get_external_id()[g.id] or '')))
