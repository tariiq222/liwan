# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, timedelta
from uuid import uuid4

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.webvue_api.controllers.common import ApiError


@tagged('post_install', '-at_install', 'webvue')
class TestLeaveCancellationConcurrency(TransactionCase):
    def _fixture(self):
        self.assertTrue(self.env.cr.dbname.startswith('webvue_scratch_'), 'Committed fixtures require an isolated scratch database (including CI).')
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {})
            profile = env.ref('webvue_platform.tenant_profile')
            profile._webvue_initialize_legacy_policy(env['webvue.feature.registry']._webvue_installed_module_ids())
            company = env.company
            users = []
            for role in ('employee', 'hr_manager'):
                user = new_test_user(env, login='cancel_race_' + uuid4().hex, groups='webvue_core.group_employee', context={'no_reset_password': True}, company_id=company.id, company_ids=[(6, 0, company.ids)])
                env['webvue.access.service']._webvue_replace_assignments(user, [{'role_id': env.ref('webvue_core.role_employee' if role == 'employee' else 'webvue_hr.role_hr_manager').id, 'company_id': company.id}])
                users.append(user)
            scoped = env(context={'allowed_company_ids': company.ids})
            employee = scoped['hr.employee'].create({'name': 'Race employee', 'company_id': company.id, 'user_id': users[0].id})
            kind = scoped['hr.leave.type'].create({'name': 'Race leave', 'requires_allocation': False, 'leave_validation_type': 'hr', 'company_id': company.id, 'work_entry_type_id': env.ref('hr_work_entry.work_entry_type_leave').id})
            day = date.today() + timedelta(days=45)
            day += timedelta(days=(0 - day.weekday()) % 7)
            leave = scoped['hr.leave'].create({'employee_id': employee.id, 'holiday_status_id': kind.id, 'request_date_from': day, 'request_date_to': day})
            leave.action_approve()
            fixture = {'company': company.id, 'owner': users[0].id, 'manager': users[1].id, 'leave': leave.id, 'employee': employee.id, 'kind': kind.id, 'partners': [u.partner_id.id for u in users]}
            cursor.commit()
            return fixture

    def _env(self, cursor, fixture, manager=False):
        return api.Environment(cursor, fixture['manager' if manager else 'owner'], {'allowed_company_ids': [fixture['company']]})

    def _cleanup(self, fixture):
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {'allowed_company_ids': [fixture['company']]})
            env['webvue.hr.leave.cancellation'].search([('leave_id', '=', fixture['leave'])]).unlink()
            leave = env['hr.leave'].browse(fixture['leave'])
            if leave.state not in ('cancel', 'refuse'):
                leave.action_refuse()
            leave.unlink()
            env['hr.employee'].browse(fixture['employee']).unlink()
            env['hr.leave.type'].browse(fixture['kind']).unlink()
            env['res.users'].browse([fixture['owner'], fixture['manager']]).unlink()
            env['res.partner'].browse(fixture['partners']).unlink()
            cursor.commit()

    def test_concurrent_submission_has_one_pending_aggregate(self):
        fixture = self._fixture()
        try:
            with self.registry.cursor() as stale:
                model = self._env(stale, fixture)['webvue.hr.leave.cancellation']
                self.assertFalse(model.search([]))
                with self.registry.cursor() as first:
                    winner = self._env(first, fixture)['webvue.hr.leave.cancellation'].action_request(fixture['leave'], 'First')
                    winning_id = winner.id
                    first.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    model.action_request(fixture['leave'], 'Concurrent')
                stale.rollback()
            with self.registry.cursor() as retry:
                row = self._env(retry, fixture)['webvue.hr.leave.cancellation'].action_request(fixture['leave'], 'Retry')
                self.assertEqual((row.id, row.state, row.revision), (winning_id, 'pending', 1))
                self.assertEqual(row.reason, 'First')
                self.assertEqual(row.leave_id.state, 'validate')
                retry.rollback()
        finally:
            self._cleanup(fixture)

    def _request(self, fixture):
        with self.registry.cursor() as cursor:
            row = self._env(cursor, fixture)['webvue.hr.leave.cancellation'].action_request(fixture['leave'], 'Request')
            request_id = row.id
            cursor.commit()
            return request_id

    def test_racing_decisions_have_one_effect(self):
        fixture = self._fixture()
        try:
            request_id = self._request(fixture)
            with self.registry.cursor() as stale:
                row = self._env(stale, fixture, True)['webvue.hr.leave.cancellation'].browse(request_id)
                self.assertEqual((row.state, row.revision), ('pending', 1))
                with self.registry.cursor() as first:
                    self._env(first, fixture, True)['webvue.hr.leave.cancellation'].browse(request_id).action_approve(1, 'Approved once')
                    first.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    row.action_refuse(1, 'Losing refusal')
                stale.rollback()
            with self.registry.cursor() as retry:
                env = self._env(retry, fixture, True)
                row = env['webvue.hr.leave.cancellation'].browse(request_id)
                with self.assertRaises(ApiError) as error:
                    row.action_refuse(1, 'Stale replay')
                self.assertEqual(error.exception.status, 409)
                self.assertEqual((row.state, row.revision, row.leave_id.state), ('approved', 2, 'cancel'))
                self.assertEqual(row.reviewer_id.id, fixture['manager'])
                self.assertFalse(env['resource.calendar.leaves'].search([('holiday_id', '=', fixture['leave'])]))
                self.assertEqual(sum('Manager approved cancellation' in body for body in row.message_ids.mapped('body')), 1)
                retry.rollback()
        finally:
            self._cleanup(fixture)

    def test_native_edit_racing_approval_conflicts(self):
        fixture = self._fixture()
        try:
            request_id = self._request(fixture)
            with self.registry.cursor() as stale:
                row = self._env(stale, fixture, True)['webvue.hr.leave.cancellation'].browse(request_id)
                self.assertEqual(row.leave_id.state, 'validate')
                with self.registry.cursor() as editor:
                    env = api.Environment(editor, SUPERUSER_ID, {'allowed_company_ids': [fixture['company']]})
                    env['hr.leave'].browse(fixture['leave']).write({'notes': 'External edit'})
                    editor.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    row.action_approve(1)
                stale.rollback()
            with self.registry.cursor() as retry:
                row = self._env(retry, fixture, True)['webvue.hr.leave.cancellation'].browse(request_id)
                with self.assertRaises(ApiError) as error:
                    row.action_approve(1)
                self.assertEqual(error.exception.status, 409)
                self.assertEqual((row.state, row.leave_id.state), ('pending', 'validate'))
                row.action_refuse(1, 'Reload after edit')
                retry.commit()
            with self.registry.cursor() as resubmit:
                row = self._env(resubmit, fixture)['webvue.hr.leave.cancellation'].action_request(fixture['leave'], 'Fresh')
                self.assertEqual((row.id, row.state, row.revision), (request_id, 'pending', 3))
                self.assertEqual(row.leave_version, row.leave_id.write_date)
                resubmit.rollback()
        finally:
            self._cleanup(fixture)
