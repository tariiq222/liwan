# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase

ALLOCATION_KEYS = {'id', 'employee', 'leave_type', 'number_of_days', 'date_from', 'date_to', 'state'}


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

    # --- list, read and edit -----------------------------------------------------------

    def _granted(self, employee, days=5):
        self.authenticate('alloc_peer', 'alloc_peer_pass_123')
        res = self._grant(employee, days=days)
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()['id']

    def test_manager_lists_reads_and_edits_an_allocation(self):
        allocation_id = self._granted(self.staff)
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        listed = self.api('GET', f'/api/v1/hr/leave/allocations?employee_id={self.staff.id}&limit=1')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()['total'], 1)
        self.assertEqual([item['id'] for item in listed.json()['items']], [allocation_id])
        self.assertEqual(set(listed.json()['items'][0]), ALLOCATION_KEYS)
        one = self.api('GET', f'/api/v1/hr/leave/allocations/{allocation_id}')
        self.assertEqual((one.status_code, one.json()['number_of_days']), (200, 5.0))

        valid_to = (date.today() + timedelta(days=90)).isoformat()
        patched = self.api('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {
            'number_of_days': 8, 'date_to': valid_to,
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual((patched.json()['number_of_days'], patched.json()['date_to']), (8.0, valid_to))
        self.assertEqual(patched.json()['state'], 'validate')
        allocation = self.env['hr.leave.allocation'].browse(allocation_id)
        self.assertEqual(allocation.number_of_days, 8.0)
        cleared = self.api('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {'date_to': None})
        self.assertEqual((cleared.status_code, cleared.json()['date_to']), (200, None))

    def test_allocation_patch_is_validated(self):
        allocation_id = self._granted(self.staff)
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        path = f'/api/v1/hr/leave/allocations/{allocation_id}'
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        for body, field in (
            ({}, None),
            ({'number_of_days': 0}, 'number_of_days'),
            ({'number_of_days': True}, 'number_of_days'),
            ({'date_to': yesterday}, 'date_to'),
            ({'date_from': None}, 'date_from'),
            ({'employee_id': self.no_account.id}, 'employee_id'),
            ({'leave_type_id': self.annual.id}, 'leave_type_id'),
        ):
            res = self.api('PATCH', path, body)
            self.assertEqual(res.status_code, 422, (body, res.text))
            self.assertEqual(res.json().get('field'), field, body)
        self.assertEqual(self.env['hr.leave.allocation'].browse(allocation_id).number_of_days, 5.0)

    def test_manager_cannot_edit_their_own_allocation(self):
        allocation_id = self._granted(self.manager_employee)
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {'number_of_days': 50})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.env['hr.leave.allocation'].browse(allocation_id).number_of_days, 5.0)

    def test_edit_cannot_drop_below_the_days_already_taken(self):
        allocation_id = self._granted(self.staff, days=5)
        start = date.today() + timedelta(days=7 - date.today().weekday())
        leave = self.env['hr.leave'].create({
            'employee_id': self.staff.id, 'holiday_status_id': self.annual.id,
            'request_date_from': start, 'request_date_to': start + timedelta(days=2),
        })
        leave.action_approve()
        self.assertEqual(leave.state, 'validate')
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {'number_of_days': 1})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(self.env['hr.leave.allocation'].browse(allocation_id).number_of_days, 5.0)
        # A validity that ends before the taken days leaves them uncovered just the same.
        res = self.api('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {
            'date_to': (start - timedelta(days=1)).isoformat(),
        })
        self.assertEqual(res.status_code, 422, res.text)
        self.assertFalse(self.env['hr.leave.allocation'].browse(allocation_id).date_to)

    def test_allocation_routes_need_the_manage_capability(self):
        allocation_id = self._granted(self.no_account)
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method, path, body in (
            ('GET', '/api/v1/hr/leave/allocations', None),
            ('GET', f'/api/v1/hr/leave/allocations/{allocation_id}', None),
            ('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {'number_of_days': 99}),
        ):
            res = self.api(method, path, body)
            self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'), path)

    def test_another_company_allocation_is_a_404(self):
        other_company = self.env['res.company'].create({'name': 'Allocation Other Company'})
        other_employee = self.env['hr.employee'].create({'name': 'Elsewhere', 'company_id': other_company.id})
        foreign = self.env['hr.leave.allocation'].create({
            'employee_id': other_employee.id, 'holiday_status_id': self.annual.id,
            'number_of_days': 3, 'date_from': date.today(),
        })
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        path = f'/api/v1/hr/leave/allocations/{foreign.id}'
        self.assertEqual(self.api('GET', path).status_code, 404)
        self.assertEqual(self.api('PATCH', path, {'number_of_days': 9}).status_code, 404)
        listed = self.api('GET', '/api/v1/hr/leave/allocations').json()
        self.assertNotIn(foreign.id, {item['id'] for item in listed['items']})

    # --- revoke --------------------------------------------------------------------------

    def test_manager_revokes_an_allocation_once(self):
        allocation_id = self._granted(self.staff)
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        path = f'/api/v1/hr/leave/allocations/{allocation_id}/revoke'
        revoked = self.api('POST', path, {})
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertEqual(set(revoked.json()), ALLOCATION_KEYS)
        self.assertEqual(revoked.json()['state'], 'refuse')
        self.assertEqual(self.env['hr.leave.allocation'].browse(allocation_id).state, 'refuse')
        again = self.api('POST', path, {})
        self.assertEqual((again.status_code, again.json()['code']), (422, 'invalid'))
        edit = self.api('PATCH', f'/api/v1/hr/leave/allocations/{allocation_id}', {'number_of_days': 9})
        self.assertEqual(edit.status_code, 422, edit.text)
        stray = self.api('POST', f'/api/v1/hr/leave/allocations/{self._granted(self.no_account)}/revoke', {'reason': 'x'})
        self.assertEqual((stray.status_code, stray.json().get('field')), (422, 'reason'))

    def test_revoke_is_refused_for_ones_own_and_without_the_capability(self):
        own = self._granted(self.manager_employee)
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        refused = self.api('POST', f'/api/v1/hr/leave/allocations/{own}/revoke', {})
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        other = self._granted(self.staff)
        self.authenticate('api_emp', 'api_emp_pass_123')
        denied = self.api('POST', f'/api/v1/hr/leave/allocations/{other}/revoke', {})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        for allocation_id in (own, other):
            self.assertEqual(self.env['hr.leave.allocation'].browse(allocation_id).state, 'validate')

    def test_revoke_cannot_strand_leave_already_taken(self):
        allocation_id = self._granted(self.staff, days=5)
        start = date.today() + timedelta(days=7 - date.today().weekday())
        leave = self.env['hr.leave'].create({
            'employee_id': self.staff.id, 'holiday_status_id': self.annual.id,
            'request_date_from': start, 'request_date_to': start + timedelta(days=2),
        })
        leave.action_approve()
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self.api('POST', f'/api/v1/hr/leave/allocations/{allocation_id}/revoke', {})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(self.env['hr.leave.allocation'].browse(allocation_id).state, 'validate')

    def test_another_company_allocation_cannot_be_revoked(self):
        other_company = self.env['res.company'].create({'name': 'Revoke Other Company'})
        other_employee = self.env['hr.employee'].create({'name': 'Far Away', 'company_id': other_company.id})
        foreign = self.env['hr.leave.allocation'].create({
            'employee_id': other_employee.id, 'holiday_status_id': self.annual.id,
            'number_of_days': 3, 'date_from': date.today(),
        })
        self.authenticate('alloc_mgr', 'alloc_mgr_pass_123')
        res = self.api('POST', f'/api/v1/hr/leave/allocations/{foreign.id}/revoke', {})
        self.assertEqual(res.status_code, 404, res.text)
