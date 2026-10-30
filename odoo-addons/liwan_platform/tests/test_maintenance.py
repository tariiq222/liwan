# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan', 'liwan_maintenance')
class TestMaintenance(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env['liwan.entitlement.service']._liwan_profile().root_company_id
        cls.manager = new_test_user(cls.env, login='maintenance_mgr', groups='liwan_core.group_customer_admin,liwan_platform.group_maintenance_manager', company_id=cls.company.id)
        cls.employee = new_test_user(cls.env, login='maintenance_emp', groups='liwan_core.group_employee', company_id=cls.company.id)
        cls.Preference = cls.env['liwan.maintenance.preference'].with_user(cls.manager).with_company(cls.company)
        cls.Booking = cls.env['liwan.maintenance.booking'].with_user(cls.manager).with_company(cls.company)
        cls.release = cls.env['liwan.maintenance.release'].with_context(**{OPERATOR_CONTEXT: True}).create({
            'company_id': cls.company.id, 'release_id': 'release-test-1',
            'deadline_at': fields.Datetime.now() + timedelta(days=30),
            'estimated_seconds': 120, 'scope': 'tenant', 'policy': 'Operator-set deadline.',
        })

    def _payload(self):
        return {'release_id': self.release.id, 'scheduled_at': fields.Datetime.now() + timedelta(days=1), 'timezone': 'Asia/Riyadh', 'duration_minutes': 60}

    def test_preference_cas_and_direct_orm_bypass(self):
        pref = self.Preference._liwan_update({'timezone': 'Asia/Riyadh', 'weekday': 4, 'start_minute': 120, 'duration_minutes': 60}, 0)
        self.assertEqual(pref.revision, 1)
        with self.assertRaises(LiwanAccessRule) as error:
            self.Preference._liwan_update({'weekday': 3}, 0)
        self.assertEqual(error.exception.status, 409)
        with self.assertRaises(AccessError):
            pref.write({'revision': 999})
        with self.assertRaises(AccessError):
            self.Preference.with_user(self.employee)._liwan_update({'weekday': 3}, 1)

    def test_validation_errors_use_the_requested_arabic_or_english_locale(self):
        self.env['res.lang']._activate_lang('ar_001')
        for lang, message in [
            ('ar_001', 'حقول تفضيل الصيانة غير صالحة.'),
            ('en_US', 'Invalid maintenance preference fields.'),
        ]:
            with self.subTest(lang=lang), self.assertRaises(ValidationError) as error:
                self.Preference.with_context(lang=lang)._liwan_update({}, 0)
            self.assertEqual(str(error.exception), message)
        with self.assertRaises(ValidationError) as error:
            self.Booking.with_context(lang='ar_001')._liwan_schedule({
                **self._payload(), 'timezone': 'Invalid/Timezone',
            })
        self.assertEqual(str(error.exception), 'يلزم تحديد منطقة زمنية صالحة بصيغة IANA.')

    def test_book_only_supported_notices_and_valid_windows(self):
        booking = self.Booking._liwan_schedule(self._payload())
        self.assertEqual(booking.status, 'scheduled')
        with self.assertRaises(LiwanAccessRule):
            self.Booking._liwan_schedule(self._payload())
        with self.assertRaises(AccessError):
            self.release.with_user(self.manager).write({'estimated_seconds': 1})
        with self.assertRaises(AccessError):
            booking.write({'status': 'complete'})

    def test_started_booking_cannot_be_cancelled_or_rescheduled(self):
        booking = self.Booking._liwan_schedule(self._payload())
        operator = booking.with_env(self.env).with_context(**{OPERATOR_CONTEXT: True})
        with patch('odoo.fields.Datetime.now', return_value=booking.scheduled_at):
            operator._liwan_transition('running', booking.revision)
        with self.assertRaises(LiwanAccessRule):
            booking._liwan_update({'status': 'cancelled'}, booking.revision)
        self.assertEqual(booking.status, 'running')

    def test_claim_rechecks_remaining_measured_duration_atomically(self):
        booking = self.Booking._liwan_schedule(self._payload())
        operator = booking.with_env(self.env).with_context(**{OPERATOR_CONTEXT: True})
        late = booking.scheduled_at + timedelta(minutes=59)
        with patch('odoo.fields.Datetime.now', return_value=late), self.assertRaises(ValidationError):
            operator._liwan_transition('running', booking.revision)
        self.assertEqual(booking.status, 'scheduled')

    def test_reject_past_short_deadline_and_foreign_company(self):
        for changes in [
            {'scheduled_at': fields.Datetime.now() - timedelta(hours=1)},
            {'duration_minutes': 1},
            {'scheduled_at': self.release.deadline_at},
        ]:
            with self.assertRaises(ValidationError):
                self.Booking._liwan_schedule({**self._payload(), **changes})
        other = self.env['res.company'].create({'name': 'Unrelated maintenance root'})
        with self.assertRaises(AccessError):
            self.Booking.with_company(other)._liwan_schedule(self._payload())

    def test_shared_scope_is_operator_scheduled_and_withdrawn_is_not_bookable(self):
        self.release.with_context(**{OPERATOR_CONTEXT: True}).write({'scope': 'ai_service'})
        with self.assertRaises(ValidationError):
            self.Booking._liwan_schedule(self._payload())
        self.release.with_context(**{OPERATOR_CONTEXT: True}).write({'scope': 'tenant', 'status': 'withdrawn'})
        with self.assertRaises(ValidationError):
            self.Booking._liwan_schedule(self._payload())

    def test_terminal_bookings_cannot_be_blindly_rebooked(self):
        booking = self.Booking._liwan_schedule(self._payload())
        operator = booking.with_env(self.env).with_context(**{OPERATOR_CONTEXT: True})
        with patch('odoo.fields.Datetime.now', return_value=booking.scheduled_at):
            operator._liwan_transition('running', 1)
            operator._liwan_transition('failed', 2)
        with self.assertRaises(LiwanAccessRule):
            self.Booking._liwan_schedule(self._payload())

    def test_immutable_events_capture_preference_and_booking_history(self):
        pref = self.Preference._liwan_update({'timezone': 'Asia/Riyadh', 'weekday': 4, 'start_minute': 120, 'duration_minutes': 60}, 0)
        self.Preference._liwan_update({'weekday': 3}, pref.revision)
        booking = self.Booking._liwan_schedule(self._payload())
        booking._liwan_update({'status': 'cancelled'}, booking.revision)
        Event = self.env['liwan.maintenance.event'].with_user(self.manager)
        events = Event.search([('preference_id', '=', pref.id)], order='id')
        self.assertEqual(len(events), 2)
        self.assertEqual(events[-1].old_weekday, 4)
        self.assertEqual(events[-1].new_weekday, 3)
        self.assertEqual(events[-1].create_uid, self.manager)
        self.assertTrue(events[-1].create_date)
        history = Event.search([('booking_id', '=', booking.id)], order='id')
        self.assertEqual(history.mapped('action'), ['booking_scheduled', 'booking_cancelled'])
        self.assertEqual(history[-1].old_status, 'scheduled')
        self.assertEqual(history[-1].new_status, 'cancelled')
        self.assertEqual(history[-1].revision, 2)
        with self.assertRaises(AccessError):
            Event.create({'company_id': self.company.id, 'action': 'booking_complete', 'booking_id': booking.id, 'revision': 3})
        with self.assertRaises(AccessError):
            history[-1].write({'action': 'booking_complete'})
        with self.assertRaises(AccessError):
            history[-1].unlink()
        with self.assertRaises(AccessError):
            Event.with_context(_liwan_maintenance_audit='forged').create({'company_id': self.company.id, 'action': 'booking_complete', 'booking_id': booking.id, 'revision': 3})
