# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import time

from psycopg2 import IntegrityError

from odoo.exceptions import AccessError, UserError
from odoo.fields import Command
from odoo.tests import mute_logger, new_test_user, tagged

from .common import (
    AGENT_URL,
    EVENTS_KEY_ROOT,
    LINE_NUMBERS,
    MANAGER_PASSWORD,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    LiwanTelephonyCase,
    LiwanTelephonyEventsCase,
    derived_key,
    set_feature,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_telephony.models.access_service import EVENTS_APPLY
from odoo.addons.liwan_telephony.models.agent_client import (
    DATABASE_HEADER,
    REVERSE_LABEL,
    _liwan_sign_reverse,
)
from odoo.addons.liwan_telephony.models.feature_registry import RECORDING_FEATURE

EVENTS = '/api/v1/telephony/events'
CALLS = '/api/v1/telephony/calls'
NO_TRACEBACK = 'odoo.addons.liwan_api.controllers.common'


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyConstraints(LiwanTelephonyCase):
    """Odoo 19 creates a constraint only from ``models.Constraint``: these prove the database refuses the duplicates."""

    def refused(self, model, values):
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.env.cr.savepoint():
            self.env[model].create(values)

    def test_a_second_extension_number_in_a_company_or_another_branch_is_refused(self):
        self.refused('liwan.telephony.extension', {'number': '1001'})
        branch = self.env['res.company'].create({'name': 'Constraint branch', 'parent_id': self.company.id})
        self.refused('liwan.telephony.extension', {'number': '1001', 'company_id': branch.id})

    def test_cross_company_extension_link_is_refused(self):
        branch = self.env['res.company'].create({'name': 'Check company branch', 'parent_id': self.company.id})
        branch_ext = self.env['liwan.telephony.extension'].create({'number': '2099', 'company_id': branch.id})
        with self.assertRaises(UserError):
            self.call.write({'extension_id': branch_ext.id})

    def test_an_extension_number_outside_the_pattern_is_refused(self):
        for number in ('1', '12345678901', '10a1', ' 101', '١٠١'):
            self.refused('liwan.telephony.extension', {'number': number})

    def test_a_second_call_with_the_same_linkedid_in_a_company_is_refused(self):
        self.refused('liwan.telephony.call', {'linkedid': '1764049999.1', 'direction': 'in', 'state': 'ended'})

    def test_a_second_event_with_the_same_event_id_is_refused(self):
        self.env['liwan.telephony.event'].create({
            'event_id': 'same-event', 'linkedid': '1764049999.1', 'call_id': self.call.id,
        })
        self.refused('liwan.telephony.event', {'event_id': 'same-event', 'linkedid': '1764049999.1'})

    def test_a_line_lists_each_number_once(self):
        self.refused('liwan.telephony.line.number', {'line_id': self.line.id, 'number': LINE_NUMBERS[0]})
        self.refused('liwan.telephony.line.number', {'line_id': self.line.id, 'number': '966500000001'})


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyEvents(LiwanTelephonyEventsCase):

    def call_of(self, linkedid):
        return self.env['liwan.telephony.call'].search([('linkedid', '=', linkedid)])

    def test_an_event_creates_the_call_once_and_a_replay_changes_nothing(self):
        first = self.post_event(self.make_envelope('e-1'))
        self.assertEqual((first.status_code, first.json()['applied']), (200, True), first.text)
        call = self.env['liwan.telephony.call'].browse(first.json()['callId'])
        self.assertEqual(
            (call.direction, call.state, call.remote_number, call.extension_number),
            ('in', 'answered', '+966500000000', '1001'),
        )
        self.assertEqual(call.linkedid, '1764049999.9')
        # The extension, the employee behind it and the partner behind the number are linked by the event itself.
        self.assertEqual(
            (call.extension_id, call.user_id, call.partner_id, call.company_id),
            (self.extension, self.manager, self.partner, self.company),
        )
        replay = self.post_event(self.make_envelope('e-1'))
        self.assertEqual((replay.status_code, replay.json()), (200, {'applied': False, 'reason': 'already applied'}))
        self.assertEqual(self.env['liwan.telephony.event'].search_count([('event_id', '=', 'e-1')]), 1)
        self.assertEqual(len(self.call_of('1764049999.9')), 1)

    def test_a_later_event_moves_the_call_forward_and_never_back(self):
        self.post_event(self.make_envelope('e-1', state='ringing', linkedid='1764050000.0', answered_at=None))
        self.post_event(self.make_envelope(
            'e-2', state='ended', linkedid='1764050000.0', ended_at='2026-11-25T09:02:05.000000Z',
        ))
        call = self.call_of('1764050000.0')
        self.assertEqual((call.state, call.duration_seconds), ('ended', 125))
        late = self.post_event(self.make_envelope('e-3', state='ringing', linkedid='1764050000.0', answered_at=None))
        self.assertTrue(late.json()['applied'])
        self.assertEqual(self.call_of('1764050000.0').state, 'ended')

    def test_the_parties_follow_the_direction_and_the_number_is_e164_or_null(self):
        # Outgoing: the remote party is the connected number and the extension the caller. A national number is read
        # in the call's country. The call's own direction decides every later leg, whatever label it carries.
        out = self.make_envelope(
            'out-1', direction='out', linkedid='1764050000.1', caller_number='1001',
            connected_number='0500000000', dialed_exten='+966500000000',
        )
        self.post_event(out)
        self.post_event(self.make_envelope(
            'out-2', direction='in', linkedid='1764050000.1', caller_number='1001',
            connected_number='0500000000', dialed_exten='0500000000',
        ))
        call = self.call_of('1764050000.1')
        self.assertEqual((call.direction, call.remote_number, call.extension_number), ('out', '+966500000000', '1001'))
        self.assertEqual(call.extension_id, self.extension)
        # CEL / unanswered outgoing call: connected_number is null, so remote_number falls back to dialed_exten.
        self.post_event(self.make_envelope(
            'out-cel', direction='out', state='missed', linkedid='1764050000.10',
            caller_number='1001', connected_number=None, dialed_exten='0500000000', answered_at=None,
        ))
        cel_out = self.call_of('1764050000.10')
        self.assertEqual((cel_out.remote_number, cel_out.partner_id, cel_out.extension_id), (
            '+966500000000', self.partner, self.extension,
        ))
        # Internal: no remote party, the dialled extension.
        self.post_event(self.make_envelope(
            'int-1', direction='internal', linkedid='1764050000.2', caller_number='1001',
            connected_number='1002', dialed_exten='1002',
        ))
        internal = self.call_of('1764050000.2')
        self.assertEqual((internal.remote_number, internal.extension_id), (False, self.spare_extension))
        self.assertFalse(internal.user_id)
        # A number the phone library refuses is stored as null, never with a plus put in front of it.
        self.post_event(self.make_envelope('odd-1', linkedid='1764050000.3', caller_number='**61#', dialed_exten=None))
        self.assertFalse(self.call_of('1764050000.3').remote_number)
        self.assertFalse(self.call_of('1764050000.3').partner_id)

    def test_timezone_offset_is_converted_to_utc(self):
        res = self.post_event(self.make_envelope(
            'tz-1', linkedid='1764050000.11', state='ended',
            started_at='2026-11-25T12:00:00+03:00',
            answered_at='2026-11-25T12:00:05+03:00',
            ended_at='2026-11-25T12:01:05+03:00',
        ))
        self.assertEqual(res.status_code, 200, res.text)
        call = self.call_of('1764050000.11')
        self.assertEqual(str(call.started_at), '2026-11-25 09:00:00')
        self.assertEqual(str(call.answered_at), '2026-11-25 09:00:05')
        self.assertEqual(str(call.ended_at), '2026-11-25 09:01:05')
        self.assertEqual(call.duration_seconds, 65)

    def test_a_call_of_a_branch_extension_is_stored_under_the_branch_and_visible_there(self):
        branch = self.env['res.company'].create({'name': 'Telephony branch', 'parent_id': self.company.id})
        self.assertIn(branch, self.events_user.company_ids)
        extension = self.env['liwan.telephony.extension'].create({'number': '2001', 'company_id': branch.id})
        event = self.make_envelope('branch-1', linkedid='1764050000.7', dialed_exten='2001')
        self.post_event(event)
        call = self.call_of('1764050000.7')
        self.assertEqual((call.company_id, call.extension_id), (branch, extension))
        branch_manager = new_test_user(
            self.env, login='telephony_branch_manager', password='telephony_branch_manager_pass_123',
            name='Branch Manager', groups='liwan_core.group_employee', company_id=branch.id,
            company_ids=[Command.set([branch.id])],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(branch_manager, [{
            'role_id': self.env.ref('liwan_telephony.role_telephony_manager').id, 'company_id': branch.id,
        }])
        self.authenticate('telephony_branch_manager', 'telephony_branch_manager_pass_123')
        listed = self.api('GET', CALLS).json()['items']
        self.assertEqual([item['companyId'] for item in listed], [branch.id])
        # Multi-company ir.rule on liwan.telephony.event isolates receipts per company.
        self.assertEqual(
            self.env['liwan.telephony.event'].with_user(branch_manager).with_company(branch).search_count([
                ('linkedid', '=', '1764050000.7'),
            ]),
            1,
        )
        self.assertEqual(
            self.env['liwan.telephony.event'].with_user(self.manager).with_company(self.company).search_count([
                ('linkedid', '=', '1764050000.7'),
            ]),
            0,
        )
        self.authenticate('telephony_manager', MANAGER_PASSWORD)
        self.assertEqual([item['id'] for item in self.api('GET', CALLS).json()['items']], [self.call.id])
        # A replay of the branch event finds its receipt, and a later event finds the call, across companies.
        replay = self.post_event(event)
        self.assertEqual(replay.json(), {'applied': False, 'reason': 'already applied'})
        self.post_event(self.make_envelope('branch-2', linkedid='1764050000.7', dialed_exten='2001', state='ended'))
        self.assertEqual(self.call_of('1764050000.7').state, 'ended')
        self.assertEqual(self.env['liwan.telephony.event'].search_count([('linkedid', '=', '1764050000.7')]), 2)
        # A call in HQ whose later event names a branch extension must NEVER link that branch's extension.
        self.post_event(self.make_envelope('hq-only-1', linkedid='1764050000.8', dialed_exten=None, state='ringing'))
        self.post_event(self.make_envelope('hq-only-2', linkedid='1764050000.8', dialed_exten='2001', state='answered'))
        hq_call = self.call_of('1764050000.8')
        self.assertEqual(hq_call.company_id, self.company)
        self.assertFalse(hq_call.extension_id)

    def test_the_recording_link_answers_200_only_after_a_recording_ready_event(self):
        set_feature(self, RECORDING_FEATURE)
        self.set_agent()
        sent = []

        def agent(method, url, payload, headers):
            sent.append((method, url, payload, headers))
            return {'url': 'https://recordings.test/1764049999.9.wav', 'expiresInSeconds': 60}

        self.patch_agent(agent)
        self.post_event(self.make_envelope('rec-1'))
        call = self.call_of('1764049999.9')
        link = f'{CALLS}/{call.id}/recording'
        self.authenticate('telephony_manager', MANAGER_PASSWORD)
        refused = self.api('GET', link)
        self.assertEqual((refused.status_code, refused.json()['code']), (404, 'not_found'))
        self.post_event(self.make_envelope('rec-2', state='ended', recording='ready'))
        refreshed = self.call_of('1764049999.9')
        self.assertEqual((refreshed.state, refreshed.recording_state), ('answered', 'available'))
        self.assertTrue(self.api('GET', f'{CALLS}/{call.id}').json()['canListen'])
        granted = self.api('GET', link)
        self.assertEqual((granted.status_code, granted.json()), (200, {
            'url': 'https://recordings.test/1764049999.9.wav', 'expiresInSeconds': 60,
        }))
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        body = json.loads(payload)
        self.assertEqual((method, url), ('POST', f'{AGENT_URL}/recordings/link'))
        self.assertEqual(body, {
            'linkedid': '1764049999.9', 'database': self.env.cr.dbname,
            'expires_at': body['expires_at'],
        })
        reverse_key = derived_key(EVENTS_KEY_ROOT, self.env.cr.dbname, REVERSE_LABEL)
        self.assertEqual(headers[DATABASE_HEADER], self.env.cr.dbname)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(reverse_key, headers[TIMESTAMP_HEADER], 'POST', '/recordings/link', payload),
        )
        audit = self.env['liwan.telephony.recording.access'].search([('call_id', '=', call.id)])
        self.assertEqual(audit.user_id, self.manager)

    def test_a_recording_ready_event_of_an_unknown_call_creates_it_ended(self):
        """The agent's final event carries the flag: a call Odoo never saw is created as it ended, with its
        recording, and no later event moves it back."""
        final = self.make_envelope(
            'rec-9', linkedid='1764050000.9', state='ended', recording='ready',
            ended_at='2026-11-25T09:03:00.000000Z',
        )
        self.post_event(final)
        call = self.call_of('1764050000.9')
        self.assertEqual((call.state, call.recording_state, call.duration_seconds), ('ended', 'available', 180))
        self.post_event(self.make_envelope('rec-10', linkedid='1764050000.9', state='ringing'))
        self.post_event(final)
        self.assertEqual((call.state, call.recording_state), ('ended', 'available'))
        self.assertEqual(self.env['liwan.telephony.event'].search_count([('linkedid', '=', '1764050000.9')]), 2)

    def test_every_bad_proof_header_answers_403_without_a_traceback(self):
        good = self.event_headers(self.make_envelope('bad-1'))
        cases = [
            {TIMESTAMP_HEADER: 'not-a-number', SIGNATURE_HEADER: 'ab' * 32},
            {TIMESTAMP_HEADER: '9' * 20, SIGNATURE_HEADER: 'ab' * 32},
            {TIMESTAMP_HEADER: '17_640', SIGNATURE_HEADER: 'ab' * 32},
            {TIMESTAMP_HEADER: good[TIMESTAMP_HEADER], SIGNATURE_HEADER: 'é' * 64},
            {TIMESTAMP_HEADER: good[TIMESTAMP_HEADER], SIGNATURE_HEADER: 'zz' * 32},
            {TIMESTAMP_HEADER: good[TIMESTAMP_HEADER]},
            {SIGNATURE_HEADER: good[SIGNATURE_HEADER]},
            {},
        ]
        with self.assertNoLogs(NO_TRACEBACK, 'ERROR'):
            for headers in cases:
                result = self.post_event(self.make_envelope('bad-1'), headers=headers)
                self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), headers)
        self.assertFalse(self.call_of('1764049999.9'))

    def test_a_bad_signature_a_future_timestamp_and_a_missing_or_malformed_key_answer_403(self):
        bad = self.post_event(self.make_envelope('sig-1'), signature='00' * 32)
        future = self.post_event(self.make_envelope('fut-1'), when=int(time.time()) + 3600)
        for result in (bad, future):
            self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), result.text)
        with self.assertNoLogs(NO_TRACEBACK, 'ERROR'):
            for bad_root in (False, 'not-hex', 'ab' * 16, 'zz' * 32):
                self.env['ir.config_parameter'].sudo().set_param('liwan.telephony.events_key_root', bad_root)
                missing = self.post_event(self.make_envelope('key-1'))
                self.assertEqual((missing.status_code, missing.json()), (
                    403, {'code': 'forbidden', 'message': 'The telephony events key is not configured.'},
                ))
        self.assertFalse(self.call_of('1764049999.9'))

    def test_a_closed_feature_answers_403(self):
        set_feature(self, 'telephony.enabled', False)
        result = self.post_event(self.make_envelope('off-1'))
        self.assertEqual((result.status_code, result.json()['code']), (403, 'feature_not_included'))
        self.assertFalse(self.call_of('1764049999.9'))

    def test_a_malformed_event_answers_422_and_wrong_database_answers_403(self):
        base = self.make_envelope('x')
        missing_key_payloads = [
            {**base, 'call': {key: value for key, value in base['call'].items() if key != missing}}
            for missing in ('caller_number', 'connected_number', 'dialed_exten', 'started_at', 'answered_at', 'ended_at')
        ]
        with self.assertNoLogs(NO_TRACEBACK, 'ERROR'):
            for payload in (
                [],
                {'event_id': 'x'},
                {key: value for key, value in base.items() if key != 'database'},
                {**base, 'database': 123},
                {**base, 'database': ''},
                {**base, 'call': {**base['call'], 'direction': 'sideways'}},
                {**base, 'call': {**base['call'], 'state': 'talking'}},
                {**base, 'call': {**base['call'], 'started_at': 1764000000}},
                {**base, 'call': {**base['call'], 'started_at': 'not-a-date'}},
                {**base, 'call': {**base['call'], 'started_at': '2026-11-25'}},
                {**base, 'call': {**base['call'], 'ended_at': '2026-13-45T99:99:99Z'}},
                {**base, 'call': {**base['call'], 'answered_at': ''}},
                {**base, 'call': {**base['call'], 'recording': None}},
                {**base, 'call': {**base['call'], 'recording': 'pending'}},
                {**base, 'source': 7},
                *missing_key_payloads,
            ):
                result = self.post_event(payload)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'), payload)
            wrong_db = self.post_event({**base, 'database': 'other_tenant_db'})
            self.assertEqual((wrong_db.status_code, wrong_db.json()['code']), (403, 'forbidden'), wrong_db.text)
        raw = self.url_open(
            EVENTS, data=b'not json',
            headers={'Content-Type': 'application/json', **self.event_headers({})}, method='POST',
        )
        self.assertEqual(raw.status_code, 400)
        self.assertFalse(self.env['liwan.telephony.event'].search([('event_id', '=', 'x')]))

    def test_concurrent_duplicate_event_receipt_returns_already_applied(self):
        # Pre-seed the receipt and hide it from the pre-check (simulating a REPEATABLE READ race) so PostgreSQL
        # raises a real UniqueViolation (23505) on Event.create inside the savepoint.
        self.env['liwan.telephony.event'].create({
            'event_id': 'race-1', 'linkedid': '1764049999.1', 'call_id': self.call.id,
        })
        event_model = type(self.env['liwan.telephony.event'])
        self.patch(event_model, 'search_count', lambda _records, _domain, **_kwargs: 0)
        with mute_logger('odoo.sql_db'):
            result = self.post_event(self.make_envelope('race-1', linkedid='1764050000.99'))
        self.assertEqual((result.status_code, result.json()), (200, {'applied': False, 'reason': 'already applied'}))
        # Savepoint rolled back the call creation too.
        self.assertFalse(self.call_of('1764050000.99'))


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyEventsIdentity(LiwanTelephonyCase):

    def test_the_identity_is_active_and_out_of_every_administrators_reach(self):
        user = self.events_user
        self.assertTrue(user.active)
        self.assertFalse(user.password)
        self.assertEqual(user.group_ids, self.env.ref('liwan_telephony.group_telephony_events'))
        service = self.env['liwan.access.service']
        self.assertIn(user.id, service._liwan_technical_user_ids())
        with self.assertRaises(LiwanAccessRule) as refused:
            service._liwan_assert_user_scope(user)
        self.assertEqual((refused.exception.code, refused.exception.status), ('not_found', 404))
        with self.assertRaises(LiwanAccessRule) as refused:
            service._liwan_assert_account_reactivation(user)
        self.assertEqual((refused.exception.code, refused.exception.status), ('protected_user', 403))
        self.assertNotIn(user, self.env['res.users'].search(service._liwan_account_user_domain({})))

    def test_the_identity_holds_its_capability_only_while_it_acts_as_itself(self):
        service = self.env['liwan.access.service']
        acting = service.with_user(self.events_user)
        self.assertEqual(acting._liwan_capability_keys(self.events_user), {EVENTS_APPLY})
        self.assertNotIn(EVENTS_APPLY, service._liwan_capability_keys(self.events_user))
        self.assertNotIn(EVENTS_APPLY, service._liwan_capability_keys(self.manager))
        for role in self.env['liwan.access.role'].search([]):
            self.assertNotIn(EVENTS_APPLY, role.permission_ids.mapped('key'))

    def test_the_identity_reads_each_company_it_belongs_to(self):
        """The company fence admits the identity outside its home company through its capability."""
        acting = self.env['liwan.telephony.call'].with_user(self.events_user)
        self.assertEqual(acting.search([('linkedid', '=', '1764049999.1')]), self.call)
        self.assertEqual(
            self.env['liwan.telephony.extension'].with_user(self.events_user)._liwan_by_number('1001'),
            self.extension,
        )

    def test_the_route_identity_is_the_events_user(self):
        self.assertTrue(self.events_user.has_group('liwan_telephony.group_telephony_events'))
        with self.assertRaises(AccessError):
            self.env['liwan.telephony.call'].with_user(self.outsider).check_access('write')
