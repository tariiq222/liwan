# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta

from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase

KINDS = ('hr.leave_approved', 'hr.leave_refused')


def _next_monday(start):
    return start + timedelta(days=(0 - start.weekday()) % 7 or 7)


@tagged('post_install', '-at_install', 'webvue')
class TestLeaveBell(WebVueHrCase):
    """HR-146: a leave decision reaches the employee's bell, always, and never the decider's."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        company.country_id = cls.env.ref('base.sa')
        cls.manager = new_test_user(
            cls.env, login='hr_bell_mgr', password='hr_bell_mgr_pass_123',
            name='Bell Manager', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id, 'company_id': company.id,
        }])
        cls.env['hr.employee'].create({'name': 'Bell Manager', 'user_id': cls.manager.id, 'company_id': company.id})
        cls.staff = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1) or \
            cls.env['hr.employee'].create({'name': cls.employee.name, 'user_id': cls.employee.id, 'company_id': company.id})
        cls.other = new_test_user(
            cls.env, login='hr_bell_other', password='hr_bell_other_pass_123',
            name='Bell Other', groups='webvue_core.group_employee',
        )
        cls.env['hr.employee'].create({'name': 'Bell Other', 'user_id': cls.other.id, 'company_id': company.id})
        cls.annual = cls.env.ref('hr_holidays.leave_type_paid_time_off')
        cls.monday = _next_monday(date.today() + timedelta(days=14))
        cls.env['hr.leave.allocation'].create({
            'employee_id': cls.staff.id, 'holiday_status_id': cls.annual.id, 'number_of_days': 21,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()

    def _login(self, login):
        self.authenticate(login, f'{login}_pass_123')

    def _request_leave(self):
        self._login('api_emp')
        res = self.api('POST', '/api/v1/hr/leave/requests', json={
            'leave_type_id': self.annual.id, 'date_from': self.monday.isoformat(),
            'date_to': self.monday.isoformat(), 'notes': 'Family trip',
        })
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()['id']

    def _decide(self, leave_id, action):
        self._login('hr_bell_mgr')
        return self.api('POST', f'/api/v1/hr/leave/requests/{leave_id}/{action}', json={})

    def _rows(self, login):
        self._login(login)
        return [item for item in self.api('GET', '/api/v1/notifications').json()['items'] if item['kind'] in KINDS]

    def _bell_count(self, leave_id, kind):
        return self.env['mail.message'].search_count([
            ('webvue_notification_kind', '=', kind), ('model', '=', 'hr.leave'), ('res_id', '=', leave_id),
        ])

    def test_approval_reaches_only_the_employee(self):
        leave_id = self._request_leave()
        self.assertEqual(self._decide(leave_id, 'approve').status_code, 200)
        rows = self._rows('api_emp')
        self.assertEqual([(r['kind'], r['leave_id'], r['is_read']) for r in rows], [('hr.leave_approved', leave_id, False)])
        self.assertIn(self.monday.isoformat(), rows[0]['title'])
        self.assertEqual(self._rows('hr_bell_mgr'), [])
        self.assertEqual(self._rows('hr_bell_other'), [])

    def test_refusal_reaches_the_employee(self):
        leave_id = self._request_leave()
        self.assertEqual(self._decide(leave_id, 'refuse').status_code, 200)
        rows = self._rows('api_emp')
        self.assertEqual([(r['kind'], r['leave_id']) for r in rows], [('hr.leave_refused', leave_id)])
        self.assertEqual(self._rows('hr_bell_mgr'), [])

    def test_a_retried_decision_adds_no_second_row(self):
        leave_id = self._request_leave()
        self.assertEqual(self._decide(leave_id, 'approve').status_code, 200)
        self._decide(leave_id, 'approve')
        leave = self.env['hr.leave'].browse(leave_id)
        leave._webvue_notify_decision()
        self.assertEqual(self._bell_count(leave_id, 'hr.leave_approved'), 1)
        self.assertEqual(len(self._rows('api_emp')), 1)

    def test_the_decider_is_never_notified_of_their_own_leave(self):
        leave_id = self._request_leave()
        self.assertEqual(self._decide(leave_id, 'approve').status_code, 200)
        self.env['mail.message'].search([('webvue_notification_kind', '=', 'hr.leave_approved')]).unlink()
        self.env['hr.leave'].browse(leave_id).with_user(self.employee)._webvue_notify_decision()
        self.assertEqual(self._bell_count(leave_id, 'hr.leave_approved'), 0)

    def test_the_first_of_two_approvals_is_not_a_decision(self):
        leave = self.env['hr.leave'].browse(self._request_leave())
        leave.state = 'validate1'
        leave._webvue_notify_decision()
        self.assertEqual(self.env['mail.message'].search_count([('webvue_notification_kind', 'in', KINDS)]), 0)
