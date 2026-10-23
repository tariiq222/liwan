# Part of Odoo. See LICENSE file for full copyright and licensing details.
import inspect
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api, fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from .common import WebVueHrCase, set_hr_feature
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.controllers.shifts import settings


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

    def test_independent_shift_manager_can_read_and_edit_only_current_policy(self):
        # Product custom roles receive employee read transitively through catalog
        # dependencies. This test-only role isolates the settings capability contract.
        role = self.env['webvue.access.role'].create({
            'key': 'test_independent_shift_policy_manager', 'name_ar': 'Shift policy contract',
            'type': 'built_in', 'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', '=', 'hr.shifts.manage'),
            ]).ids)],
        })
        self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])
        service = self.env['webvue.access.service']
        self.assertFalse(service._webvue_has_capability(self.manager, 'hr.employees.read'))
        self.assertTrue(service._webvue_has_capability(self.manager, 'hr.shifts.manage'))
        own = self.env['webvue.hr.shift.settings'].create({'company_id': self.company.id})
        other = self.env['webvue.hr.shift.settings'].create({'company_id': self.other_company.id})
        self.manager.company_ids = [(4, self.other_company.id)]
        self._as_manager()
        response = self.api('GET', '/api/v1/hr/shifts/settings')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['revision'], own.revision)
        saved = self.api('PATCH', '/api/v1/hr/shifts/settings', {'day_reference': 'user', 'revision': own.revision})
        self.assertEqual(saved.status_code, 200, saved.text)
        model = self.env['webvue.hr.shift.settings'].with_user(self.manager).with_context(
            allowed_company_ids=[self.company.id, self.other_company.id],
        )
        self.assertEqual(model.search([]), own)
        self.assertEqual(model.browse(own.id).read(['day_reference'])[0]['day_reference'], 'user')
        with self.assertRaises(AccessError):
            model.browse(other.id).read(['day_reference'])
        self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [])
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/settings').status_code, 403)
        with self.assertRaises(AccessError):
            model.search([])

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
        # Without the later global branch-selector guard, the settings schema
        # rejects company_id as unwritable before creating any company record.
        self.assertEqual(result.status_code, 422, result.text)
        self.assertEqual(result.json()['code'], 'invalid')
        self.assertEqual(result.json()['field'], 'company_id')
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


@tagged('post_install', '-at_install', 'webvue')
class TestHrShiftSettingsConcurrency(TransactionCase):
    """Independent committed snapshots; the ordinary HttpCase cursor serializes requests."""

    def _fixture(self):
        if not self.env.cr.dbname.startswith('webvue_scratch_'):
            self.fail('Committed concurrency fixtures require a webvue_scratch_ database.')
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {})
            company = env.company
            self.assertFalse(env['webvue.hr.shift.settings'].search([('company_id', '=', company.id)]),
                             'The committed fixture must not replace an existing policy.')
            user = new_test_user(env, login='shift_cas_' + uuid4().hex, groups='webvue_core.group_employee',
                                 context={'no_reset_password': True},
                                 company_id=company.id, company_ids=[(6, 0, company.ids)])
            env['webvue.access.service']._webvue_replace_assignments(user, [{
                'role_id': env.ref('webvue_hr.role_hr_manager').id, 'company_id': company.id,
            }])
            cursor.commit()
            return company.id, user.id, user.partner_id.id

    def _patch(self, cursor, fixture, reference, revision):
        env = api.Environment(cursor, fixture[1], {'allowed_company_ids': [fixture[0]]})
        # Exercise the actual controller body and its savepoint/model checks.
        # HTTP dispatch/retry is covered separately by the normal-server acceptance.
        with patch.object(settings, 'request', SimpleNamespace(env=env)):
            return inspect.unwrap(settings.HrShiftSettingsController.patch_settings)(
                settings.HrShiftSettingsController(), day_reference=reference, revision=revision,
            )

    def _cleanup(self, fixture):
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {})
            env['webvue.hr.shift.settings'].search([('company_id', '=', fixture[0])]).unlink()
            env['res.users'].browse(fixture[1]).unlink()
            env['res.partner'].browse(fixture[2]).unlink()
            cursor.commit()

    def test_stale_update_requires_native_retry_then_revision_conflict(self):
        fixture = self._fixture()
        try:
            with self.registry.cursor() as setup:
                self._patch(setup, fixture, 'company', 0)
                setup.commit()
            with self.registry.cursor() as stale:
                env = api.Environment(stale, fixture[1], {'allowed_company_ids': [fixture[0]]})
                self.assertEqual(env['webvue.hr.shift.settings']._webvue_current().revision, 1)
                with self.registry.cursor() as first:
                    self.assertEqual(self._patch(first, fixture, 'user', 1)['revision'], 2)
                    first.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    self._patch(stale, fixture, 'company', 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(ApiError) as error:
                    self._patch(retry, fixture, 'company', 1)
                self.assertEqual(error.exception.status, 409)
                row = api.Environment(retry, fixture[1], {'allowed_company_ids': [fixture[0]]})['webvue.hr.shift.settings']._webvue_current()
                self.assertEqual((row.revision, row.day_reference), (2, 'user'))
                retry.rollback()
        finally:
            self._cleanup(fixture)

    def test_stale_first_create_conflicts_without_overwriting_the_winner(self):
        fixture = self._fixture()
        try:
            with self.registry.cursor() as stale:
                env = api.Environment(stale, fixture[1], {'allowed_company_ids': [fixture[0]]})
                self.assertFalse(env['webvue.hr.shift.settings']._webvue_current())
                with self.registry.cursor() as first:
                    self.assertEqual(self._patch(first, fixture, 'user', 0)['revision'], 1)
                    first.commit()
                with self.assertRaises(ApiError) as error, mute_logger('odoo.sql_db'):
                    self._patch(stale, fixture, 'company', 0)
                self.assertEqual(error.exception.status, 409)
                stale.rollback()
            with self.registry.cursor() as verify:
                row = api.Environment(verify, fixture[1], {'allowed_company_ids': [fixture[0]]})['webvue.hr.shift.settings']._webvue_current()
                self.assertEqual((row.revision, row.day_reference), (1, 'user'))
        finally:
            self._cleanup(fixture)
