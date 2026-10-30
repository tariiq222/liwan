# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import LiwanAppointmentsCase

REASONS = '/api/v1/appointments/reasons'
BOOKINGS = '/api/v1/appointments/bookings'
SETTINGS = '/api/v1/appointments/settings'
REASON_KEYS = {'id', 'kind', 'name', 'sequence', 'active'}


@tagged('post_install', '-at_install', 'liwan')
class TestAppointmentReasons(LiwanAppointmentsCase):

    def _login(self, name='manager'):
        self.authenticate('appointments_%s' % name, 'appointments_%s_pass_123' % name)

    def _error(self, result, status, code, field=None):
        body = result.json()
        self.assertEqual((result.status_code, body.get('code')), (status, code), result.text)
        if field:
            self.assertEqual(body.get('field'), field, result.text)

    def _reason(self, kind='visit', name='Consultation', company=None, **values):
        reason = self.env['liwan.appointment.reason'].create({
            'company_id': (company or self.env.company).id, 'kind': kind, 'name': name, **values,
        })
        self.env.flush_all()
        return reason

    def _settings(self, **values):
        self.env['liwan.appointment.settings'].create({'company_id': self.env.company.id, **values})
        self.env.flush_all()

    # --- the reason routes ---

    def test_manager_creates_edits_archives_and_restores(self):
        self._login()
        created = self.api('POST', REASONS, json={'kind': 'visit', 'name': ' Follow-up ', 'sequence': 20})
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(set(body), REASON_KEYS)
        self.assertEqual((body['kind'], body['name'], body['sequence'], body['active']), ('visit', 'Follow-up', 20, True))
        path = '%s/%d' % (REASONS, body['id'])
        patched = self.api('PATCH', path, json={'name': 'Review', 'sequence': 5})
        self.assertEqual((patched.status_code, patched.json()['name'], patched.json()['sequence']), (200, 'Review', 5), patched.text)
        self.assertEqual(self.api('POST', path + '/archive').json()['active'], False)
        self.assertNotIn(body['id'], {item['id'] for item in self.api('GET', REASONS).json()['items']})
        archived = self.api('GET', REASONS + '?active=false').json()
        self.assertEqual(([item['id'] for item in archived['items']], archived['total']), ([body['id']], 1))
        self.assertEqual(self.api('POST', path + '/unarchive').json()['active'], True)

    def test_the_list_filters_by_kind_and_orders_by_sequence(self):
        later = self._reason('visit', 'Later', sequence=30)
        first = self._reason('visit', 'First', sequence=10)
        cancel = self._reason('cancel', 'Changed my mind')
        self._login('booker')
        every = self.api('GET', REASONS).json()
        self.assertEqual(every['total'], len(every['items']))
        ids = [item['id'] for item in every['items']]
        self.assertLess(ids.index(first.id), ids.index(later.id))
        visits = {item['id'] for item in self.api('GET', REASONS + '?kind=visit').json()['items']}
        self.assertEqual(visits & {first.id, later.id, cancel.id}, {first.id, later.id})
        self.assertEqual([item['id'] for item in self.api('GET', REASONS + '?kind=cancel').json()['items']], [cancel.id])
        self.assertEqual(len(self.api('GET', REASONS + '?limit=1').json()['items']), 1)
        self._error(self.api('GET', REASONS + '?kind=other'), 422, 'invalid', 'kind')
        self._error(self.api('GET', REASONS + '?active=maybe'), 422, 'invalid', 'active')

    def test_reading_needs_a_capability_and_writing_needs_manage(self):
        reason = self._reason()
        path = '%s/%d' % (REASONS, reason.id)
        writes = (
            ('POST', REASONS, {'kind': 'visit', 'name': 'X'}), ('PATCH', path, {'name': 'X'}),
            ('POST', path + '/archive', None), ('POST', path + '/unarchive', None),
        )
        for login, password in (('api_emp', 'api_emp_pass_123'), ('appointments_booker', 'appointments_booker_pass_123')):
            self.authenticate(login, password)
            self.assertEqual(self.api('GET', REASONS).status_code, 200, login)
            for method, url, body in writes:
                self._error(self.api(method, url, json=body), 403, 'forbidden')
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        self.assertEqual(self.api('GET', REASONS).status_code, 403)
        self.assertEqual(reason.name, 'Consultation')

    def test_manage_in_another_company_does_not_grant_the_routes(self):
        reason = self._reason()
        self._assert_forbidden_in_the_current_company([
            ('GET', REASONS, None), ('POST', REASONS, {'kind': 'visit', 'name': 'X'}),
            ('PATCH', '%s/%d' % (REASONS, reason.id), {'name': 'X'}),
        ])

    def test_another_companys_reasons_are_invisible(self):
        other = self.env['res.company'].create({'name': 'Other reasons company'})
        foreign = self._reason('visit', 'Foreign', company=other)
        own = self._reason('visit', 'Own')
        self._login()
        self.assertEqual({item['id'] for item in self.api('GET', REASONS).json()['items']} & {foreign.id, own.id}, {own.id})
        for method, url, body in (
            ('PATCH', '%s/%d' % (REASONS, foreign.id), {'name': 'Hijack'}),
            ('POST', '%s/%d/archive' % (REASONS, foreign.id), None),
            ('POST', '%s/%d/unarchive' % (REASONS, foreign.id), None),
        ):
            self._error(self.api(method, url, json=body), 404, 'not_found')
        self.assertEqual((foreign.name, foreign.active), ('Foreign', True))
        self._error(self.api('PATCH', REASONS + '/999999999', json={'name': 'X'}), 404, 'not_found')

    def test_invalid_bodies_are_422(self):
        self._login()
        reason = self._reason()
        for body, field in (
            ({'name': 'X'}, 'kind'), ({'kind': 'visit'}, 'name'), ({'kind': 'other', 'name': 'X'}, 'kind'),
            ({'kind': 'visit', 'name': ' '}, 'name'), ({'kind': 'visit', 'name': 5}, 'name'),
            ({'kind': 'visit', 'name': 'x' * 256}, 'name'), ({'kind': 'visit', 'name': 'X', 'sequence': -1}, 'sequence'),
            ({'kind': 'visit', 'name': 'X', 'sequence': True}, 'sequence'), ({'kind': 'visit', 'name': 'X', 'company_id': 1}, 'company_id'),
        ):
            self._error(self.api('POST', REASONS, json=body), 422, 'invalid', field)
        for body, field in (({'kind': 'cancel'}, 'kind'), ({'name': ''}, 'name'), ({'active': False}, 'active')):
            self._error(self.api('PATCH', '%s/%d' % (REASONS, reason.id), json=body), 422, 'invalid', field)

    def test_a_reason_belongs_to_the_company_of_the_booking(self):
        other = self.env['res.company'].create({'name': 'Booking reason company'})
        with self.assertRaises(ValidationError):
            self.booking.liwan_visit_reason_id = self._reason('visit', 'Foreign', company=other)
        with self.assertRaises(ValidationError):
            self.booking.liwan_visit_reason_id = self._reason('cancel', 'Wrong kind')
        with self.assertRaises(ValidationError):
            self.booking.liwan_cancel_reason_id = self._reason('visit', 'Wrong kind again')

    # --- visit reason on create and patch ---

    def _create(self, **extra):
        return self.api('POST', BOOKINGS, json={
            'type_id': self.booking_type.id, 'requester': {'name': 'Sara Ali', 'phone': '+966500000001'}, **extra,
        })

    def test_the_visit_reason_is_stored_and_shown(self):
        reason = self._reason('visit', 'Procedure')
        self._login('booker')
        created = self._create(visit_reason_id=reason.id)
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()['visit_reason'], {'id': reason.id, 'name': 'Procedure'})
        self.assertIsNone(created.json()['cancel_reason'])
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, created.json()['id'])).json()['visit_reason']['id'], reason.id)
        self.assertIsNone(self._create().json()['visit_reason'])

    def test_a_bad_visit_reason_is_a_422(self):
        other = self.env['res.company'].create({'name': 'Visit reason company'})
        archived = self._reason('visit', 'Archived')
        archived.active = False
        bad = (
            self._reason('visit', 'Foreign', company=other).id, self._reason('cancel', 'Wrong kind').id, archived.id, 999999999,
        )
        self._login('booker')
        for reason_id in bad:
            self._error(self._create(visit_reason_id=reason_id), 422, 'invalid', 'visit_reason_id')
        for value in (0, 'x', True, [1]):
            self._error(self._create(visit_reason_id=value), 422, 'invalid', 'visit_reason_id')
        pending = self._create().json()
        self._error(self.api('PATCH', '%s/%d' % (BOOKINGS, pending['id']), json={'visit_reason_id': bad[0]}), 422, 'invalid', 'visit_reason_id')

    def test_the_visit_reason_policies(self):
        reason = self._reason()
        self._login('booker')
        self._settings(visit_reason_field='hidden')
        self._error(self._create(visit_reason_id=reason.id), 422, 'invalid', 'visit_reason_id')
        self.assertEqual(self._create().status_code, 200)
        settings = self.env['liwan.appointment.settings'].search([])
        settings.visit_reason_field = 'required'
        self.env.flush_all()
        self._error(self._create(), 422, 'invalid', 'visit_reason_id')
        self._error(self._create(visit_reason_id=None), 422, 'invalid', 'visit_reason_id')
        self.assertEqual(self._create(visit_reason_id=reason.id).status_code, 200)
        settings.visit_reason_field = 'optional'
        self.env.flush_all()
        self.assertEqual(self._create(visit_reason_id=None).status_code, 200)

    def test_patching_the_visit_reason(self):
        first, second = self._reason('visit', 'First'), self._reason('visit', 'Second')
        self._login('booker')
        booking = self._create(visit_reason_id=first.id).json()
        path = '%s/%d' % (BOOKINGS, booking['id'])
        self.assertEqual(self.api('PATCH', path, json={'visit_reason_id': second.id}).json()['visit_reason']['id'], second.id)
        self.assertIsNone(self.api('PATCH', path, json={'visit_reason_id': None}).json()['visit_reason'])
        for body, field in (({}, 'visit_reason_id'), ({'visit_reason_id': first.id, 'notes': 'x'}, 'notes')):
            self._error(self.api('PATCH', path, json=body), 422, 'invalid', field)
        settings = self.env['liwan.appointment.settings'].create({'company_id': self.env.company.id, 'visit_reason_field': 'required'})
        self.env.flush_all()
        self._error(self.api('PATCH', path, json={'visit_reason_id': None}), 422, 'invalid', 'visit_reason_id')
        settings.visit_reason_field = 'hidden'
        self.env.flush_all()
        self._error(self.api('PATCH', path, json={'visit_reason_id': first.id}), 422, 'invalid', 'visit_reason_id')
        self.api('POST', path + '/cancel')
        settings.visit_reason_field = 'optional'
        self.env.flush_all()
        self._error(self.api('PATCH', path, json={'visit_reason_id': first.id}), 422, 'invalid')
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', path, json={'visit_reason_id': first.id}).status_code, 403)

    # --- cancel reason ---

    def test_a_cancel_reason_is_optional_by_default_and_stored_when_given(self):
        reason = self._reason('cancel', 'Changed my mind')
        self._login('booker')
        plain = self._create().json()
        canceled = self.api('POST', '%s/%d/cancel' % (BOOKINGS, plain['id']))
        self.assertEqual((canceled.status_code, canceled.json()['state'], canceled.json()['cancel_reason']), (200, 'canceled', None), canceled.text)
        with_reason = self._create().json()
        result = self.api('POST', '%s/%d/cancel' % (BOOKINGS, with_reason['id']), json={'reason_id': reason.id})
        self.assertEqual((result.status_code, result.json()['cancel_reason']), (200, {'id': reason.id, 'name': 'Changed my mind'}), result.text)
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, with_reason['id'])).json()['cancel_reason']['id'], reason.id)

    def test_a_required_cancel_reason(self):
        reason = self._reason('cancel', 'No longer needed')
        self._settings(cancel_reason_required=True)
        self._login('booker')
        booking = self._create().json()
        path = '%s/%d/cancel' % (BOOKINGS, booking['id'])
        self._error(self.api('POST', path), 422, 'invalid', 'reason_id')
        self._error(self.api('POST', path, json={'reason_id': None}), 422, 'invalid', 'reason_id')
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, booking['id'])).json()['state'], 'pending')
        self.assertEqual(self.api('POST', path, json={'reason_id': reason.id}).json()['state'], 'canceled')

    def test_a_bad_cancel_reason_is_a_422_and_leaves_the_booking_open(self):
        other = self.env['res.company'].create({'name': 'Cancel reason company'})
        archived = self._reason('cancel', 'Archived')
        archived.active = False
        bad = (self._reason('cancel', 'Foreign', company=other).id, self._reason('visit', 'Wrong kind').id, archived.id, 999999999)
        self._login('booker')
        booking = self._create().json()
        path = '%s/%d/cancel' % (BOOKINGS, booking['id'])
        for reason_id in bad:
            self._error(self.api('POST', path, json={'reason_id': reason_id}), 422, 'invalid', 'reason_id')
        for body, field in (({'reason_id': 0}, 'reason_id'), ({'reason_id': 'x'}, 'reason_id'), ({'note': 'x'}, 'note')):
            self._error(self.api('POST', path, json=body), 422, 'invalid', field)
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, booking['id'])).json()['state'], 'pending')

    # --- presets seed the lists ---

    def _names(self, kind='visit'):
        reasons = self.env['liwan.appointment.reason'].with_context(lang='en_US', active_test=False).search([
            ('company_id', '=', self.env.company.id), ('kind', '=', kind),
        ])
        return reasons.mapped('name')

    def test_the_clinic_preset_adds_its_visit_reasons_once_and_never_deletes(self):
        self.env['res.lang']._activate_lang('ar_001')
        existing = self._reason('visit', 'Lab', sequence=99)
        existing.active = False
        custom = self._reason('visit', 'Home visit')
        mine = self._reason('cancel', 'Moved abroad')
        self._login()
        applied = self.api('PATCH', SETTINGS, json={'preset': 'clinic', 'revision': 0})
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual(sorted(self._names()), ['Consultation', 'Follow-up', 'Home visit', 'Lab', 'Procedure'])
        self.assertEqual((existing.sequence, existing.active, custom.active, mine.active), (99, False, True, True))
        again = self.api('PATCH', SETTINGS, json={'preset': 'clinic', 'revision': 1})
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(len(self._names()), 5)
        consultation = self.env['liwan.appointment.reason'].with_context(lang='en_US').search([('name', '=', 'Consultation')])
        self.assertEqual(consultation.with_context(lang='ar_001').name, 'كشف')
        self.assertEqual(consultation.company_id, self.env.company)

    def test_other_presets_and_plain_saves_seed_nothing(self):
        self._login()
        self.assertEqual(self.api('PATCH', SETTINGS, json={'preset': 'services', 'revision': 0}).status_code, 200)
        self.assertEqual(self.api('PATCH', SETTINGS, json={'horizon_days': 10, 'revision': 1}).status_code, 200)
        self.assertEqual(self._names(), [])
        self.assertEqual(self.api('PATCH', SETTINGS, json={'preset': 'clinic', 'revision': 2}).status_code, 200)
        self.assertEqual(len(self._names()), 4)
        self.assertEqual(self.api('PATCH', SETTINGS, json={'preset': 'general', 'revision': 3}).status_code, 200)
        self.assertEqual(len(self._names()), 4)

    def test_a_stale_preset_save_seeds_nothing(self):
        self._login()
        self.assertEqual(self.api('PATCH', SETTINGS, json={'preset': 'clinic', 'revision': 5}).status_code, 409)
        self.assertEqual(self._names(), [])

    def test_the_clinic_preset_turns_walk_ins_on_and_other_presets_leave_the_prefix(self):
        self._login()
        saved = self.api('PATCH', SETTINGS, json={'reference_prefix': 'CLN-1', 'revision': 0}).json()
        self.assertFalse(saved['walk_in_allowed'])
        clinic = self.api('PATCH', SETTINGS, json={'preset': 'clinic', 'revision': 1}).json()
        self.assertEqual((clinic['walk_in_allowed'], clinic['reference_prefix']), (True, 'CLN-1'))
        services = self.api('PATCH', SETTINGS, json={'preset': 'services', 'revision': 2}).json()
        self.assertEqual((services['walk_in_allowed'], services['reference_prefix']), (False, 'CLN-1'))
