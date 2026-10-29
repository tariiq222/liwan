# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import WebVueAppointmentsCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_appointments.models.appointment_settings import (
    DEFAULTS,
    PRESETS,
)

URL = '/api/v1/appointments/settings'
DEFAULT_BODY = {**DEFAULTS, 'sector_preset': 'general', 'presets': ['general', 'clinic', 'services'], 'revision': 0}


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentSettings(WebVueAppointmentsCase):

    def _as_manager(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')

    def test_get_dumps_defaults_without_writing_a_row(self):
        self._as_manager()
        response = self.api('GET', URL)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), DEFAULT_BODY)
        self.assertFalse(self.env['webvue.appointment.settings'].search([]))

    def test_view_and_book_read_but_cannot_write(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', URL).status_code, 200)
        self.assertEqual(self.api('PATCH', URL, {'horizon_days': 10, 'revision': 0}).status_code, 403)
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        self.assertEqual(self.api('GET', URL).status_code, 200)
        denied = self.api('PATCH', URL, {'horizon_days': 10, 'revision': 0})
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        with self.assertRaises(AccessError):
            self.env['webvue.appointment.settings'].with_user(self.employee).create({'company_id': self.env.company.id})

    def test_outsider_is_forbidden(self):
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        self.assertEqual(self.api('GET', URL).status_code, 403)
        self.assertEqual(self.api('PATCH', URL, {'horizon_days': 10, 'revision': 0}).status_code, 403)

    def test_manager_saves_and_revision_increments(self):
        self._as_manager()
        first = self.api('PATCH', URL, {'horizon_days': 10, 'phone_field': 'optional', 'requester_confirmation': True, 'revision': 0})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), {
            **DEFAULT_BODY, 'horizon_days': 10, 'phone_field': 'optional', 'requester_confirmation': True, 'revision': 1,
        })
        second = self.api('PATCH', URL, {'self_booking_policy': 'open', 'revision': 1})
        self.assertEqual(second.status_code, 200, second.text)
        body = second.json()
        self.assertEqual((body['revision'], body['horizon_days'], body['self_booking_policy']), (2, 10, 'open'))
        self.assertEqual(self.api('GET', URL).json(), body)

    def test_preset_sets_every_value_and_explicit_field_overrides(self):
        self._as_manager()
        clinic = self.api('PATCH', URL, {'preset': 'clinic', 'revision': 0})
        self.assertEqual(clinic.status_code, 200, clinic.text)
        expected = {**PRESETS['clinic'], 'sector_preset': 'clinic'}
        self.assertEqual({key: clinic.json()[key] for key in expected}, expected)
        self.assertEqual((clinic.json()['phone_field'], clinic.json()['national_id_field']), ('required', 'required'))
        services = self.api('PATCH', URL, {'preset': 'services', 'horizon_days': 14, 'email_field': 'hidden', 'revision': 1})
        self.assertEqual(services.status_code, 200, services.text)
        body = services.json()
        self.assertEqual(body['sector_preset'], 'services')
        self.assertEqual((body['default_slot_minutes'], body['horizon_days'], body['email_field']), (60, 14, 'hidden'))
        self.assertEqual(body['modification_deadline_hours'], 48)

    def test_sector_preset_changes_only_through_preset(self):
        self._as_manager()
        saved = self.api('PATCH', URL, {'horizon_days': 10, 'revision': 0})
        self.assertEqual(saved.json()['sector_preset'], 'general')
        refused = self.api('PATCH', URL, {'sector_preset': 'clinic', 'revision': 1})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'sector_preset'))
        applied = self.api('PATCH', URL, {'preset': 'clinic', 'revision': 1})
        self.assertEqual(applied.json()['sector_preset'], 'clinic')

    def test_attendance_settings_default_save_and_read_back(self):
        self._as_manager()
        got = self.api('GET', URL).json()
        self.assertEqual(
            {name: got[name] for name in (
                'attendance_tracking', 'auto_no_show', 'no_show_grace_minutes', 'walk_in_allowed',
                'visit_reason_field', 'cancel_reason_required', 'reference_prefix',
            )},
            {
                'attendance_tracking': True, 'auto_no_show': True, 'no_show_grace_minutes': 30, 'walk_in_allowed': False,
                'visit_reason_field': 'optional', 'cancel_reason_required': False, 'reference_prefix': 'APT',
            },
        )
        body = {
            'attendance_tracking': False, 'auto_no_show': False, 'no_show_grace_minutes': 0, 'walk_in_allowed': True,
            'visit_reason_field': 'required', 'cancel_reason_required': True, 'reference_prefix': 'CLN-01',
        }
        saved = self.api('PATCH', URL, {**body, 'revision': 0})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual({name: saved.json()[name] for name in body}, body)
        edge = self.api('PATCH', URL, {'no_show_grace_minutes': 1440, 'reference_prefix': 'A' * 10, 'revision': 1})
        self.assertEqual((edge.status_code, edge.json()['no_show_grace_minutes'], edge.json()['reference_prefix']), (200, 1440, 'A' * 10))

    def test_every_preset_sets_the_attendance_settings_but_not_the_prefix(self):
        self._as_manager()
        revision = 0
        for preset, walk_in in (('clinic', True), ('services', False), ('general', False)):
            saved = self.api('PATCH', URL, {'reference_prefix': 'KEEP', 'revision': revision})
            applied = self.api('PATCH', URL, {'preset': preset, 'revision': saved.json()['revision']})
            self.assertEqual(applied.status_code, 200, applied.text)
            body = applied.json()
            revision = body['revision']
            self.assertEqual(
                (body['walk_in_allowed'], body['attendance_tracking'], body['auto_no_show'], body['no_show_grace_minutes']),
                (walk_in, True, True, 30),
            )
            self.assertEqual((body['visit_reason_field'], body['cancel_reason_required'], body['reference_prefix']), ('optional', False, 'KEEP'))
        for preset, values in PRESETS.items():
            self.assertNotIn('reference_prefix', values, preset)

    def test_a_new_type_defaults_from_the_company_settings(self):
        types = self.env['resource.booking.type']
        without = types.create({'name': 'Before settings'})
        self.assertEqual((without.slot_duration, without.modifications_deadline), (0.5, 24))
        settings = self.env['webvue.appointment.settings'].create({
            'company_id': self.env.company.id, 'default_slot_minutes': 15, 'modification_deadline_hours': 48,
        })
        configured = types.create({'name': 'After settings'})
        self.assertEqual((configured.slot_duration, configured.modifications_deadline), (0.25, 48))
        explicit = types.create({'name': 'Explicit', 'slot_duration': 1.0, 'modifications_deadline': 2})
        self.assertEqual((explicit.slot_duration, explicit.modifications_deadline), (1.0, 2))
        settings.default_slot_minutes = 60
        self.assertEqual((configured.slot_duration, without.slot_duration), (0.25, 0.5))

    def test_type_defaults_follow_the_current_company_only(self):
        other = self.env['res.company'].create({'name': 'Other defaults company'})
        self.env['webvue.appointment.settings'].create({'company_id': other.id, 'default_slot_minutes': 90})
        created = self.env['resource.booking.type'].create({'name': 'Own company type'})
        self.assertEqual(created.slot_duration, 0.5)
        foreign = self.env['resource.booking.type'].with_company(other).create({'name': 'Other company type'})
        self.assertEqual(foreign.slot_duration, 1.5)

    def test_stale_revision_is_a_409(self):
        self._as_manager()
        self.assertEqual(self.api('PATCH', URL, {'horizon_days': 10, 'revision': 0}).status_code, 200)
        for revision in (0, 5):
            stale = self.api('PATCH', URL, {'horizon_days': 20, 'revision': revision})
            self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'), stale.text)
        self.assertEqual(self.api('GET', URL).json()['horizon_days'], 10)

    def test_invalid_bodies_are_422_with_field(self):
        self._as_manager()
        cases = [
            ({'default_slot_minutes': 4, 'revision': 0}, 'default_slot_minutes'),
            ({'default_slot_minutes': 481, 'revision': 0}, 'default_slot_minutes'),
            ({'min_notice_hours': -1, 'revision': 0}, 'min_notice_hours'),
            ({'horizon_days': 0, 'revision': 0}, 'horizon_days'),
            ({'horizon_days': 366, 'revision': 0}, 'horizon_days'),
            ({'horizon_days': True, 'revision': 0}, 'horizon_days'),
            ({'modification_deadline_hours': 721, 'revision': 0}, 'modification_deadline_hours'),
            ({'no_show_grace_minutes': -1, 'revision': 0}, 'no_show_grace_minutes'),
            ({'no_show_grace_minutes': 1441, 'revision': 0}, 'no_show_grace_minutes'),
            ({'no_show_grace_minutes': '30', 'revision': 0}, 'no_show_grace_minutes'),
            ({'visit_reason_field': 'maybe', 'revision': 0}, 'visit_reason_field'),
            ({'attendance_tracking': 1, 'revision': 0}, 'attendance_tracking'),
            ({'auto_no_show': 'yes', 'revision': 0}, 'auto_no_show'),
            ({'walk_in_allowed': None, 'revision': 0}, 'walk_in_allowed'),
            ({'cancel_reason_required': 'no', 'revision': 0}, 'cancel_reason_required'),
            ({'reference_prefix': '', 'revision': 0}, 'reference_prefix'),
            ({'reference_prefix': 'apt', 'revision': 0}, 'reference_prefix'),
            ({'reference_prefix': 'ABCDEFGHIJK', 'revision': 0}, 'reference_prefix'),
            ({'reference_prefix': 'A/B', 'revision': 0}, 'reference_prefix'),
            ({'reference_prefix': 'APT\n', 'revision': 0}, 'reference_prefix'),
            ({'reference_prefix': 5, 'revision': 0}, 'reference_prefix'),
            ({'requester_confirmation': 'yes', 'revision': 0}, 'requester_confirmation'),
            ({'phone_field': 'maybe', 'revision': 0}, 'phone_field'),
            ({'self_booking_policy': 'anyone', 'revision': 0}, 'self_booking_policy'),
            ({'preset': 'bank', 'revision': 0}, 'preset'),
            ({'preset': [], 'revision': 0}, 'preset'),
            ({'preset': {'clinic': 1}, 'revision': 0}, 'preset'),
            ({'phone_field': [], 'revision': 0}, 'phone_field'),
            ({'sector_preset': 'bank', 'revision': 0}, 'sector_preset'),
            ({'sector_preset': 'clinic', 'revision': 0}, 'sector_preset'),
            ({'mystery': 1, 'revision': 0}, 'mystery'),
            ({'horizon_days': 10}, 'revision'),
            ({'horizon_days': 10, 'revision': True}, 'revision'),
        ]
        for payload, field in cases:
            result = self.api('PATCH', URL, payload)
            self.assertEqual(result.status_code, 422, (payload, result.text))
            self.assertEqual(result.json().get('field'), field, payload)
        self.assertFalse(self.env['webvue.appointment.settings'].search([]))

    def test_database_checks_refuse_out_of_range_values(self):
        for name, value in (
            ('default_slot_minutes', 4), ('min_notice_hours', 721), ('horizon_days', 0), ('modification_deadline_hours', -1),
            ('no_show_grace_minutes', -1), ('no_show_grace_minutes', 1441),
            ('reference_prefix', ''), ('reference_prefix', 'lower'), ('reference_prefix', 'ABCDEFGHIJK'), ('reference_prefix', 'A B'),
        ):
            with self.assertRaises(Exception), self.cr.savepoint():  # noqa: B017 - psycopg2 CheckViolation
                self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, name: value})

    def test_another_company_row_is_neither_read_nor_written(self):
        other = self.env['res.company'].create({'name': 'Other appointment settings company'})
        foreign = self.env['webvue.appointment.settings'].create({'company_id': other.id, 'horizon_days': 99})
        self._as_manager()
        self.assertEqual(self.api('GET', URL).json()['horizon_days'], DEFAULTS['horizon_days'])
        saved = self.api('PATCH', URL, {'horizon_days': 7, 'revision': 0})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(foreign.horizon_days, 99)
        self.manager.company_ids = [(4, other.id)]
        model = self.env['webvue.appointment.settings'].with_user(self.manager).with_context(
            allowed_company_ids=[self.env.company.id, other.id],
        )
        self.assertEqual(model.search([]).company_id, self.env.company)
        with self.assertRaises(AccessError):
            model.browse(foreign.id).read(['horizon_days'])
        with self.assertRaises(AccessError):
            foreign.with_user(self.manager).write({'horizon_days': 5})
        with self.assertRaises(AccessError):
            model.create({'company_id': other.id})

    def test_feature_off_closes_both_routes(self):
        set_probe_feature(self, key='appointments.enabled', enabled=False)
        self._as_manager()
        self.assertEqual(self.api('GET', URL).status_code, 403)
        self.assertEqual(self.api('PATCH', URL, {'horizon_days': 10, 'revision': 0}).status_code, 403)
