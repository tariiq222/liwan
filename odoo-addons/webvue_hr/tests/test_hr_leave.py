# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature

LEAVE_KEYS = {
    'id', 'employee', 'leave_type', 'date_from', 'date_to', 'number_of_days',
    'state', 'notes', 'can_approve', 'can_refuse', 'can_cancel', 'can_withdraw',
    'cancellation_policy', 'cancellation', 'can_request_cancellation', 'can_approve_cancellation', 'can_refuse_cancellation',
}
BALANCE_KEYS = {'leave_type', 'allocated', 'taken', 'pending', 'remaining'}
TYPE_KEYS = {'id', 'name', 'requires_allocation', 'support_document'}
ALLOCATION_KEYS = {'id', 'employee', 'leave_type', 'number_of_days', 'date_from', 'date_to', 'state'}


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

    def _user_with_leave_role(self, login, name, capability_keys):
        """A user whose only HR access is the given leave capabilities."""
        user = new_test_user(
            self.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        role = self.env['webvue.access.role'].create({
            'key': login, 'name_ar': name, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', capability_keys),
            ]).ids)],
        })
        self.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.env.company.id,
        }])
        return user

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

    def test_self_service_leave_detail_is_own_even_for_hr_manager(self):
        own, other = self.env['hr.leave'].create([
            {'employee_id': employee.id, 'holiday_status_id': self.sick.id,
             'request_date_from': self.monday, 'request_date_to': self.monday}
            for employee in (self.manager_employee, self.staff)
        ])
        self._as_manager()
        result = self.api('GET', f'/api/v1/hr/leave/me/{own.id}')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['employee']['id'], self.manager_employee.id)
        self.assertEqual(set(result.json()), LEAVE_KEYS)
        result = self.api('GET', f'/api/v1/hr/leave/me/{other.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/requests/{other.id}').status_code, 200)
        self._as_staff()
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/me/{other.id}').status_code, 200)
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/me/{own.id}').status_code, 404)

    def test_self_service_leave_detail_preserves_feature_and_capability_gates(self):
        leave = self.env['hr.leave'].create({
            'employee_id': self.staff.id, 'holiday_status_id': self.sick.id,
            'request_date_from': self.monday, 'request_date_to': self.monday,
        })
        denied = new_test_user(self.env, login='own_leave_denied', groups='base.group_user')
        self.authenticate(denied.login, denied.login)
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/me/{leave.id}').status_code, 403)
        self._as_staff()
        set_hr_feature(self, 'hr.enabled', False)
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/me/{leave.id}').status_code, 403)

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

    def test_state_filter_takes_several_states(self):
        self._as_staff()
        pending = self._request(days=1).json()['id']
        self._as_manager()
        both = self.api('GET', '/api/v1/hr/leave/requests?state=confirm,validate1')
        self.assertEqual(both.status_code, 200, both.text)
        self.assertIn(pending, {item['id'] for item in both.json()['items']})
        only_decided = self.api('GET', '/api/v1/hr/leave/requests?state=validate,refuse').json()['items']
        self.assertNotIn(pending, {item['id'] for item in only_decided})
        unknown = self.api('GET', '/api/v1/hr/leave/requests?state=confirm,bogus')
        self.assertEqual((unknown.status_code, unknown.json()['field']), (422, 'state'))

    def test_refuse_keeps_the_reason_on_the_request(self):
        self._as_staff()
        leave_id = self._request(days=1).json()['id']
        self._as_manager()
        refused = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/refuse', json={'reason': 'Team is short that week'})
        self.assertEqual(refused.status_code, 200, refused.text)
        self.assertEqual(refused.json()['state'], 'refuse')
        leave = self.env['hr.leave'].browse(leave_id)
        self.assertIn('Team is short that week', ' '.join(leave.message_ids.mapped('body')))

    def test_employee_cancels_own_approved_leave(self):
        self._as_staff()
        leave_id = self._request(days=1).json()['id']
        self.env['hr.leave'].browse(leave_id).action_approve()
        res = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/cancel', json={'reason': 'Plans changed'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'validate')
        self.assertEqual(res.json()['cancellation']['state'], 'pending')

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

    def test_unknown_request_is_not_found(self):
        self._as_manager()
        res = self.api('GET', '/api/v1/hr/leave/requests/999999')
        self.assertEqual(res.status_code, 404)

    def test_approver_gets_the_time_off_officer_rights_without_hr_user(self):
        """Approving leave must not carry hr.group_hr_user (bank accounts, private fields)."""
        for xmlid in ('webvue_hr.group_cap_hr_leave_approve', 'webvue_hr.group_cap_hr_leave_manage'):
            implied = self.env.ref(xmlid).all_implied_ids
            self.assertIn(self.env.ref('hr_holidays.group_hr_holidays_user'), implied)
            self.assertIn(self.env.ref('hr_holidays.group_hr_holidays_responsible'), implied)
            self.assertNotIn(self.env.ref('hr.group_hr_user'), implied, xmlid)
            self.assertNotIn(self.env.ref('hr.group_hr_manager'), implied, xmlid)
            self.assertNotIn(self.env.ref('hr_holidays.group_hr_holidays_manager'), implied, xmlid)
            self.assertFalse(implied.filtered(lambda group: 'payroll' in (group.get_external_id()[group.id] or '')))

    def test_approver_cannot_read_employee_bank_accounts(self):
        self.staff.user_id.partner_id.bank_ids = [(0, 0, {'acc_number': 'SA0380000000608010167519'})]
        approver = self._user_with_leave_role(
            'leave_approver', 'معتمد إجازات', ['hr.leave.read', 'hr.employees.read', 'hr.leave.approve'],
        )
        self.assertFalse(approver.has_group('hr.group_hr_user'))
        self.assertFalse(approver.has_group('hr.group_hr_manager'))
        with self.assertRaises(AccessError):
            self.staff.user_id.partner_id.bank_ids.with_user(approver).read(['acc_number'])
        # The directory field the leave list needs stays readable through hr.leave.read,
        # which depends on hr.employees.read.
        self.assertTrue(self.staff.with_user(approver).read(['name']))
        self.assertIn('hr.employees.read', self.env['webvue.access.service']._webvue_capability_keys(approver))

    def test_requester_cannot_decide_their_own_request(self):
        self._as_manager()
        created = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.sick.id,
            'date_from': self.monday.isoformat(),
            'date_to': self.monday.isoformat(),
        })
        self.assertEqual(created.status_code, 201, created.text)
        leave_id = created.json()['id']
        self.assertFalse(created.json()['can_approve'])
        self.assertFalse(created.json()['can_refuse'])
        for decision in ('approve', 'refuse'):
            res = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/{decision}', json={})
            self.assertEqual(res.status_code, 403, decision)
        self.assertEqual(self.env['hr.leave'].browse(leave_id).state, 'confirm')

    def test_requester_withdraws_a_pending_request(self):
        self._as_staff()
        created = self._request(days=1).json()
        self.assertTrue(created['can_withdraw'])
        self.assertFalse(created['can_cancel'])
        leave_id = created['id']
        res = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/cancel', json={})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), {'id': leave_id, 'withdrawn': True})
        self.assertFalse(self.env['hr.leave'].browse(leave_id).exists())
        balances = self.api('GET', '/api/v1/hr/leave/balances').json()['items']
        annual = next(b for b in balances if b['leave_type']['id'] == self.annual.id)
        self.assertEqual(annual['pending'], 0)

    def test_withdraw_is_only_for_the_requester_and_a_pending_request(self):
        other_leave = self.env['hr.leave'].create({
            'employee_id': self.other_employee.id,
            'holiday_status_id': self.sick.id,
            'request_date_from': self.monday,
            'request_date_to': self.monday,
        })
        # The requester's own pending request is withdrawable; someone else's is not.
        self._as_staff()
        own_id = self._request(days=1).json()['id']
        self.assertTrue(self.api('GET', f'/api/v1/hr/leave/requests/{own_id}').json()['can_withdraw'])
        self._as_manager()
        self.assertFalse(self.api('GET', f'/api/v1/hr/leave/requests/{other_leave.id}').json()['can_withdraw'])
        # A decided request is cancelled, never withdrawn. The manager holds no annual
        # balance, so their own request uses a type that needs none.
        leave_id = self._request(days=1, leave_type=self.sick).json()['id']
        self.env['hr.leave'].browse(leave_id).action_approve()
        detail = self.api('GET', f'/api/v1/hr/leave/requests/{leave_id}').json()
        self.assertFalse(detail['can_withdraw'])
        self.assertFalse(detail['can_cancel'])
        self.assertTrue(detail['can_request_cancellation'])

    def test_another_company_leave_is_not_found(self):
        other_company = self.env['res.company'].create({
            'name': 'Other Company', 'country_id': self.env.ref('base.sa').id,
        })
        outsider = self.env['hr.employee'].with_company(other_company).create({
            'name': 'Outsider', 'company_id': other_company.id,
        })
        other_leave = self.env['hr.leave'].with_company(other_company).create({
            'employee_id': outsider.id,
            'holiday_status_id': self.sick.id,
            'request_date_from': self.monday,
            'request_date_to': self.monday,
        })
        self._as_manager()
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/requests/{other_leave.id}').status_code, 404)
        self.assertEqual(self.api('GET', f'/api/v1/hr/leave/me/{other_leave.id}').status_code, 404)
        self.assertEqual(self.api('POST', f'/api/v1/hr/leave/requests/{other_leave.id}/approve', json={}).status_code, 404)

    def test_a_custom_role_with_only_leave_capabilities_can_request(self):
        requester = self._user_with_leave_role(
            'hr_leave_only', 'إجازات فقط', ['hr.leave.read', 'hr.employees.read', 'hr.leave.request'],
        )
        self.env['hr.employee'].create({
            'name': 'Leave Only', 'user_id': requester.id, 'company_id': self.env.company.id,
        })
        self.authenticate('hr_leave_only', 'hr_leave_only_pass_123')
        for path in ('/api/v1/hr/leave/types', '/api/v1/hr/leave/balances', '/api/v1/hr/leave/requests'):
            res = self.api('GET', path)
            self.assertEqual(res.status_code, 200, f'{path}: {res.text}')

    def test_types_and_allocation_shapes(self):
        self._as_staff()
        types = self.api('GET', '/api/v1/hr/leave/types').json()['items']
        self.assertTrue(types)
        for item in types:
            self.assertEqual(set(item), TYPE_KEYS)
        self._as_manager()
        created = self.api('POST', '/api/v1/hr/leave/allocations', json={
            'employee_id': self.other_employee.id, 'leave_type_id': self.annual.id,
            'number_of_days': 5, 'date_from': date.today().isoformat(),
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(set(created.json()), ALLOCATION_KEYS)
        own = self.api('POST', '/api/v1/hr/leave/allocations', json={
            'employee_id': self.manager_employee.id, 'leave_type_id': self.annual.id,
            'number_of_days': 5, 'date_from': date.today().isoformat(),
        })
        self.assertEqual(own.status_code, 403, own.text)

    def test_action_bodies_reject_unknown_fields(self):
        self._as_staff()
        leave_id = self._request(days=1).json()['id']
        res = self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/cancel', json={'state': 'validate'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'state')
