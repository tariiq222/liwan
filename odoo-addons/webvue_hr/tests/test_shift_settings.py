# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature


@tagged('post_install', '-at_install', 'webvue')
class TestHrShiftSettings(WebVueHrCase):
    """Policy dates, company isolation and optimistic edits at the public boundary."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.other_company = cls.env['res.company'].create({'name': 'Other shift policy company'})
        cls.manager = new_test_user(cls.env, login='hr_policy_mgr', password='hr_policy_mgr_pass_123', groups='webvue_core.group_employee')
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id, 'company_id': cls.company.id,
        }])

    def _as_manager(self):
        self.authenticate('hr_policy_mgr', 'hr_policy_mgr_pass_123')

    def test_feature_off_closes_settings(self):
        self._as_manager()
        set_hr_feature(self, 'hr.shifts', False)
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/settings').status_code, 403)
        self.assertEqual(self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'user', 'revision': 0}).status_code, 403)

    def test_default_read_does_not_write_and_uses_company_timezone(self):
        self.company.resource_calendar_id.tz = 'Pacific/Honolulu'
        self.manager.tz = 'Pacific/Kiritimati'
        self._as_manager()
        with patch.object(fields.Datetime, 'now', return_value=datetime(2026, 10, 23, 5)):
            response = self.api('GET', '/api/v1/hr/shifts/settings')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            'day_reference': 'company', 'company_timezone': 'Pacific/Honolulu',
            'effective_timezone': 'Pacific/Honolulu', 'today': '2026-10-22', 'revision': 0,
        })
        self.assertFalse(self.env['webvue.hr.shift.settings'].search([]))

    def test_policy_save_conflict_and_user_timezone(self):
        self.manager.tz = 'Pacific/Kiritimati'
        self._as_manager()
        saved = self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'user', 'revision': 0})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['revision'], 1)
        with patch.object(fields.Datetime, 'now', return_value=datetime(2026, 10, 23, 15)):
            response = self.api('GET', '/api/v1/hr/shifts/settings')
        self.assertEqual(response.json()['today'], '2026-10-24')
        self.assertEqual(response.json()['effective_timezone'], 'Pacific/Kiritimati')
        stale = self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'company', 'revision': 0})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/settings').json()['day_reference'], 'user')

    def test_user_without_timezone_falls_back_and_dst_uses_local_calendar_day(self):
        self.company.resource_calendar_id.tz = 'America/New_York'
        self.manager.tz = False
        self._as_manager()
        self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'user', 'revision': 0})
        for instant, today in [
            (datetime(2026, 3, 8, 4, 59), '2026-03-07'),
            (datetime(2026, 3, 8, 5), '2026-03-08'),
            (datetime(2026, 3, 8, 7), '2026-03-08'),
            (datetime(2026, 11, 1, 5, 30), '2026-11-01'),
            (datetime(2026, 11, 1, 6, 30), '2026-11-01'),
        ]:
            with patch.object(fields.Datetime, 'now', return_value=instant):
                body = self.api('GET', '/api/v1/hr/shifts/settings').json()
            self.assertEqual(body['today'], today)
            self.assertEqual(body['effective_timezone'], 'America/New_York')

    def test_employee_can_read_but_cannot_write_policy(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/settings').status_code, 200)
        denied = self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'user', 'revision': 0})
        self.assertEqual(denied.status_code, 403, denied.text)
        with self.assertRaises(AccessError):
            self.env['webvue.hr.shift.settings'].with_user(self.employee).create({
                'company_id': self.company.id, 'day_reference': 'user',
            })

    def test_cross_company_policy_is_separate_and_not_writable(self):
        other = self.env['webvue.hr.shift.settings'].create({'company_id': self.other_company.id, 'day_reference': 'user'})
        self._as_manager()
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/settings').json()['day_reference'], 'company')
        own = self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'company', 'revision': 0})
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual(other.day_reference, 'user')
        with self.assertRaises(AccessError):
            other.with_user(self.manager).write({'day_reference': 'company'})
        with self.assertRaises(AccessError):
            self.env['webvue.hr.shift.settings'].with_user(self.manager).create({
                'company_id': self.other_company.id, 'day_reference': 'company',
            })

    def test_unknown_fields_and_missing_revision_are_refused(self):
        self._as_manager()
        for payload in ({'day_reference': 'browser', 'revision': 0}, {'day_reference': 'user'}, {'day_reference': 'user', 'revision': True}):
            result = self.api('PATCH', '/api/v1/hr/shifts/settings', payload)
            self.assertEqual(result.status_code, 422, result.text)

    def test_company_selector_cannot_override_current_policy(self):
        self._as_manager()
        result = self.api('PATCH', '/api/v1/hr/shifts/settings', {
            'day_reference': 'user', 'revision': 0, 'company_id': self.other_company.id,
        })
        self.assertEqual(result.status_code, 404, result.text)
        self.assertFalse(self.env['webvue.hr.shift.settings'].search([]))

    def test_raw_search_and_read_reject_revoked_employee_capability(self):
        row = self.env['webvue.hr.shift.settings'].create({'company_id': self.company.id})
        self.env['webvue.access.service']._webvue_replace_assignments(self.employee, [])
        model = self.env['webvue.hr.shift.settings'].with_user(self.employee)
        with self.assertRaises(AccessError):
            model.search([])
        with self.assertRaises(AccessError):
            row.with_user(self.employee).read(['day_reference'])

    def test_raw_search_pins_current_company_even_with_two_allowed_companies(self):
        own = self.env['webvue.hr.shift.settings'].create({'company_id': self.company.id})
        other = self.env['webvue.hr.shift.settings'].create({'company_id': self.other_company.id, 'day_reference': 'user'})
        self.manager.company_ids = [(4, self.other_company.id)]
        model = self.env['webvue.hr.shift.settings'].with_user(self.manager).with_context(allowed_company_ids=[self.company.id, self.other_company.id])
        self.assertEqual(model.search([]), own)
        with self.assertRaises(AccessError):
            model.browse(other.id).read(['day_reference'])

    def test_reference_selects_east_and_west_days_independently_of_request_context(self):
        self._as_manager()
        revision = 0
        cases = [
            ('Pacific/Kiritimati', 'Pacific/Honolulu', 'company', '2026-10-24'),
            ('Pacific/Kiritimati', 'Pacific/Honolulu', 'user', '2026-10-23'),
            ('Pacific/Honolulu', 'Pacific/Kiritimati', 'company', '2026-10-23'),
            ('Pacific/Honolulu', 'Pacific/Kiritimati', 'user', '2026-10-24'),
        ]
        for company_tz, user_tz, reference, today in cases:
            self.company.resource_calendar_id.tz = company_tz
            self.manager.tz = user_tz
            saved = self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': reference, 'revision': revision})
            self.assertEqual(saved.status_code, 200, saved.text)
            revision = saved.json()['revision']
            with patch.object(fields.Datetime, 'now', return_value=datetime(2026, 10, 23, 15)):
                body = self.api('GET', '/api/v1/hr/shifts/settings').json()
            self.assertEqual(body['today'], today)
            self.assertEqual(body['effective_timezone'], company_tz if reference == 'company' else user_tz)
