# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch
from urllib.parse import quote, urlsplit

import requests

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .test_integrations_messaging import MessagingCase
from .test_integrations_twilio import (
    AUTH_TOKEN,
    BASE,
    OTHER_SID,
    SID,
    VOICE_NUMBER,
    answer,
    sign,
    twilio_http,
)
from odoo.addons.liwan_api.tests.common import cover_isolation_routes
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_integrations_sa.providers import errors, twilio
from odoo.addons.liwan_integrations_sa.providers.twilio import voice as twilio_voice
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

VOICE = f'{BASE}/voice'
LOOKUP = f'{BASE}/lookup'
cover_isolation_routes(
    ['/api/v1/integrations/voice/calls/<int:call_id>', '/api/v1/integrations/voice/test/<int:call_id>'],
    'liwan_integrations_sa test_integrations_voice',
)
CALLER = '+966501234567'
AGENT = '+15005550007'
CALL_SID = 'CA' + '1' * 32
RECORDING_SID = 'RE' + '2' * 32
STATE_KEYS = {
    'id', 'mode', 'origin', 'state', 'to', 'from_value', 'duration_seconds', 'recorded', 'error_code',
    'error_message', 'created_at', 'started_at', 'ended_at',
}
CALL_KEYS = STATE_KEYS | {
    'connection_id', 'sender_id', 'provider', 'account_ref', 'speak_text', 'bridge_to', 'requested_by',
    'provider_call_id', 'recording_ref', 'recording_duration_seconds',
}


def accepted(sid=CALL_SID, status='queued'):
    return answer(201, {'sid': sid, 'status': status})


def sent_data(call, index=0):
    return call.call_args_list[index].kwargs['data']


class VoiceCase(MessagingCase):

    def setUp(self):
        super().setUp()
        self.voice = self.env['liwan.integration.sender'].create({
            'connection_id': self.connection.id, 'channel': 'voice', 'kind': 'number', 'value': VOICE_NUMBER, 'is_default': True,
        })
        self.Voice = self.env['liwan.integration.voice']
        self.Call = self.env['liwan.integration.call']
        self.sent = []

    def place(self, method, *args, **kwargs):
        """Run one service call with the provider create-call recorded (no socket); rows and forms are kept."""
        self.sent = []
        if not getattr(self, '_call_counter', None):
            self._call_counter = 0

        def record(external_id, credentials, call_values):
            self._call_counter += 1
            self.sent.append(dict(call_values))
            return {'provider_call_id': f'CA{"1" * 30}{self._call_counter:02d}', 'status': 'initiated'}
        with patch.object(twilio, 'create_call', side_effect=record):
            return getattr(self.Voice, method)(*args, **kwargs)

    def speak(self, **kwargs):
        values = {'to': CALLER, 'origin': 'test', 'text': 'مرحبًا', **kwargs}
        return self.Call.browse(self.place('_liwan_speak', **values)['id'])

    def bridge(self, **kwargs):
        values = {'agent_number': AGENT, 'customer_number': CALLER, 'origin': 'test', **kwargs}
        return self.Call.browse(self.place('_liwan_bridge', **values)['id'])

    def call_callback(self, row, params):
        response = self.url_open(
            urlsplit(row.status_callback_url).path, data=params,
            headers={'X-Twilio-Signature': sign(row.status_callback_url, params)}, method='POST',
        )
        row.invalidate_recordset()
        return response

    def call_params(self, row, status, **extra):
        return {'CallSid': row.provider_call_id, 'CallStatus': status, 'AccountSid': SID, **extra}


@tagged('post_install', '-at_install', 'liwan')
class TestTwilioVoiceProvider(VoiceCase):

    def test_the_twiml_escapes_every_value_and_picks_an_arabic_voice(self):
        spoken = twilio_voice.say_twiml('مرحبًا <بك> & "أهلًا"', 'ar')
        self.assertIn('voice="Polly.Zeina" language="arb"', spoken)
        self.assertNotIn('<بك>', spoken)
        self.assertIn('مرحبًا &lt;بك&gt; &amp; "أهلًا"', spoken)
        gulf = twilio_voice.say_twiml('أهلًا', 'ar-AE')
        self.assertIn('voice="Polly.Hala-Neural" language="ar-AE"', gulf)
        bridge = twilio_voice.bridge_twiml(CALLER)
        self.assertEqual(bridge, (
            '<?xml version="1.0" encoding="UTF-8"?><Response>'
            f'<Dial>{CALLER}</Dial></Response>'
        ))

    def test_create_call_sends_the_twiml_and_every_status_event(self):
        with twilio_http(accepted()) as call:
            placed = twilio.create_call(SID, {'auth_token': AUTH_TOKEN}, {
                'to': CALLER, 'sender_value': VOICE_NUMBER, 'twiml': '<Response/>',
                'status_callback': 'https://liwan.test/hook', 'record': False,
                'recording_status_callback': None,
            })
        data = sent_data(call)
        self.assertEqual((data['To'], data['From'], data['Twiml']), (CALLER, VOICE_NUMBER, '<Response/>'))
        self.assertEqual(data['StatusCallback'], 'https://liwan.test/hook')
        self.assertEqual(data['StatusCallbackMethod'], 'POST')
        self.assertEqual(sorted(data['StatusCallbackEvent']), ['answered', 'completed', 'initiated', 'ringing'])
        self.assertNotIn('Record', data)
        self.assertEqual(placed, {'provider_call_id': CALL_SID, 'status': 'initiated'})
        self.assertEqual(call.call_args_list[0].args[1], f'https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json')
        self.assertEqual(call.call_args_list[0].kwargs['auth'], (SID, AUTH_TOKEN))

    def test_create_call_requests_the_recording_only_when_asked(self):
        with twilio_http(accepted()) as call:
            twilio.create_call(SID, {'auth_token': AUTH_TOKEN}, {
                'to': CALLER, 'sender_value': VOICE_NUMBER, 'twiml': '<Response/>',
                'status_callback': 'https://liwan.test/hook', 'record': True,
                'recording_status_callback': 'https://liwan.test/recording',
            })
        data = sent_data(call)
        self.assertEqual((data['Record'], data['RecordingStatusCallback']), ('true', 'https://liwan.test/recording'))

    def test_a_call_status_moves_forward_only_and_stores_the_duration(self):
        self.assertEqual(twilio_voice.call_status({'CallStatus': 'ringing', 'CallDuration': '42'}, 'initiated'), {'state': 'ringing'})
        completed = twilio_voice.call_status({'CallStatus': 'completed', 'CallDuration': '42'}, 'in_progress')
        self.assertEqual(completed, {'state': 'completed', 'duration_seconds': 42})
        self.assertIsNone(twilio_voice.call_status({'CallStatus': 'completed', 'CallDuration': '42'}, 'completed'))
        self.assertIsNone(twilio_voice.call_status({'CallStatus': 'ringing', 'CallDuration': '42'}, 'completed'))
        self.assertIsNone(twilio_voice.call_status({'CallStatus': 'mystery'}, 'initiated'))
        unanswered = twilio_voice.call_status({'CallStatus': 'no-answer', 'CallDuration': '0'}, 'ringing')
        self.assertEqual(unanswered, {'state': 'no_answer', 'duration_seconds': 0, 'error_code': 'no_answer'})

    def test_a_recording_status_stores_only_the_reference_and_the_seconds(self):
        params = {'RecordingSid': RECORDING_SID, 'RecordingDuration': '40', 'CallSid': CALL_SID}
        self.assertEqual(twilio_voice.recording_status(params, 'completed'), {
            'recorded': True, 'recording_ref': RECORDING_SID, 'recording_duration_seconds': 40,
        })
        self.assertIsNone(twilio_voice.recording_status(params, 'in_progress'))
        self.assertIsNone(twilio_voice.recording_status({'CallSid': CALL_SID}, 'completed'))


@tagged('post_install', '-at_install', 'liwan')
class TestVoiceFlow(VoiceCase):

    def test_a_speak_call_is_committed_then_initiated_and_completed_by_signed_callbacks(self):
        row = self.speak()
        self.assertEqual((row.state, row.mode, row.to, row.from_value), ('initiated', 'speak', CALLER, VOICE_NUMBER))
        self.assertEqual(row.speak_text, 'مرحبًا')
        self.assertTrue(row.provider_call_id)
        self.assertTrue(row.status_callback_url.startswith(
            f'https://liwan.test/api/v1/public/integrations/hooks/twilio/{self.connection.id}/call-status',
        ))
        self.assertEqual(self.call_callback(row, self.call_params(row, 'ringing')).status_code, 204)
        self.assertEqual(row.state, 'ringing')
        self.assertEqual(self.call_callback(row, self.call_params(row, 'in-progress')).status_code, 204)
        self.assertEqual((row.state, bool(row.started_at)), ('in_progress', True))
        self.assertEqual(self.call_callback(row, self.call_params(row, 'completed', CallDuration='42')).status_code, 204)
        self.assertEqual((row.state, row.duration_seconds, bool(row.ended_at)), ('completed', 42, True))
        for status in ('completed', 'ringing', 'queued', 'mystery'):
            with self.subTest(status=status):
                self.assertEqual(self.call_callback(row, self.call_params(row, status)).status_code, 204)
                self.assertEqual(row.state, 'completed')

    def test_the_speak_form_carries_the_arabic_voice_and_the_stored_urls(self):
        self.speak()
        data = self.sent[0]
        self.assertEqual((data['to'], data['sender_value']), (CALLER, VOICE_NUMBER))
        self.assertIn('voice="Polly.Zeina"', data['twiml'])
        self.assertEqual(
            data['status_callback'],
            f'https://liwan.test/api/v1/public/integrations/hooks/twilio/{self.connection.id}/call-status',
        )
        self.assertFalse(data['record'])

    def test_a_timeout_or_5xx_on_creation_gives_unconfirmed_and_exactly_one_call(self):
        for failure in (requests.ReadTimeout('late'), answer(503, {'message': 'busy'})):
            with self.subTest(failure=failure), twilio_http(failure) as call:
                state = self.Voice._liwan_speak(to=CALLER, text='مرحبًا', origin='test')
            self.assertEqual((state['state'], call.call_count), ('unconfirmed', 1))
            # Nothing is retried automatically: the row stays as the failure left it.
            row = self.Call.browse(state['id'])
            row.invalidate_recordset()
            self.assertEqual(row.state, 'unconfirmed')

    def test_a_final_4xx_fails_the_row_and_the_error_code_is_kept(self):
        with twilio_http(answer(400, {'code': 21215, 'message': 'Bad From'})) as call:
            state = self.Voice._liwan_speak(to=CALLER, text='مرحبًا', origin='test')
        self.assertEqual((state['state'], state['error_code']), ('failed', '21215'))
        self.assertEqual(call.call_count, 1)

    def test_a_bridge_call_dials_the_agent_then_the_customer(self):
        row = self.bridge()
        self.assertEqual((row.mode, row.to, row.bridge_to, row.from_value), ('bridge', AGENT, CALLER, VOICE_NUMBER))
        sent = self.sent[0]
        self.assertEqual((sent['to'], sent['sender_value']), (AGENT, VOICE_NUMBER))
        self.assertIn(f'<Dial>{CALLER}</Dial>', sent['twiml'])
        self.assertNotIn('<Say>', sent['twiml'])
        self.assertFalse(sent['record'])

    def test_recording_is_requested_only_when_the_setting_is_on_and_only_the_reference_is_stored(self):
        self.assertFalse(self.env['liwan.integration.settings']._liwan_values(self.env.company)['record_calls'])
        self.speak()
        self.assertFalse(self.sent[0]['record'])
        self.env['liwan.integration.settings']._liwan_update(self.env.company, {'record_calls': True})
        row2 = self.speak()
        self.assertTrue(self.sent[0]['record'])
        self.assertEqual(
            row2.recording_status_callback_url,
            row2.status_callback_url.replace('/call-status', '/recording-status'),
        )
        # A finished call: the recording reference is stored by its own signed callback, no audio fetched.
        self.assertEqual(self.call_callback(row2, self.call_params(row2, 'completed', CallDuration='9')).status_code, 204)
        response = self.url_open(
            urlsplit(row2.recording_status_callback_url).path,
            data={'CallSid': row2.provider_call_id, 'RecordingSid': RECORDING_SID, 'RecordingDuration': '40'},
            headers={'X-Twilio-Signature': sign(row2.recording_status_callback_url, {
                'CallSid': row2.provider_call_id, 'RecordingSid': RECORDING_SID, 'RecordingDuration': '40',
            })}, method='POST',
        )
        self.assertEqual(response.status_code, 204)
        row2.invalidate_recordset()
        self.assertEqual((row2.recorded, row2.recording_ref, row2.recording_duration_seconds), (True, RECORDING_SID, 40))

    def test_the_daily_call_limit_refuses_the_next_call(self):
        self.env['liwan.integration.settings']._liwan_update(self.env.company, {'daily_call_limit': 1})
        self.speak()
        self.assertEqual(len(self.sent), 1)
        with self.assertRaises(LiwanAccessRule) as refused:
            self.speak()
        self.assertEqual(refused.exception.code, 'daily_limit_reached')
        # The refused speak reset the recorder before the limit stopped it: no second call was recorded.
        self.assertEqual(self.sent, [])
        self.login(self.admin)
        self.assertError(self.api('POST', f'{VOICE}/test', {'to': CALLER, 'mode': 'speak'}), 429, 'daily_limit_reached')

    def test_the_service_refuses_with_its_error_codes(self):
        cases = (
            ({'to': '123'}, 'invalid_phone'),
            ({'text': ''}, 'invalid'),
            ({'text': 'ب' * 501}, 'text_too_long'),
            ({'sender': 999999999}, 'sender_unavailable'),
        )
        for values, code in cases:
            with self.subTest(code=code), self.assertRaises(LiwanAccessRule) as refused:
                self.speak(**values)
            self.assertEqual(refused.exception.code, code)
            self.assertEqual(self.sent, [], 'a refused call never reached the provider')
        self.connection.state = 'disabled'
        with self.assertRaises(LiwanAccessRule) as refused:
            self.speak()
        self.assertEqual(refused.exception.code, 'connection_disabled')
        self.connection.state = 'connected'
        self.voice.is_default = False
        with self.assertRaises(LiwanAccessRule) as refused:
            self.speak()
        self.assertEqual(refused.exception.code, 'no_default_sender')

    def test_a_suspended_tenant_places_no_call(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({'status': 'suspended', 'suspension_reason': 'non_payment'})
        with self.assertRaises(LiwanAccessRule) as refused:
            self.speak()
        self.assertEqual(refused.exception.code, 'tenant_read_only')
        self.assertEqual(self.sent, [])

    def test_old_calls_are_purged_after_24_months(self):
        old, recent = self.speak(), self.speak()
        self.env.cr.execute(
            "UPDATE liwan_integration_call SET create_date = now() - interval '25 months' WHERE id = %s", (old.id,),
        )
        self.Call._liwan_purge_old()
        self.assertEqual((old.exists(), recent.exists()), (self.Call, recent))


@tagged('post_install', '-at_install', 'liwan')
class TestVoiceCompanies(VoiceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.logger = cls.make_role_user('integrations_call_log_reader', ('integrations.log.read',))
        cls.manager = cls.make_role_user('integrations_call_manager', ('integrations.read', 'integrations.manage'))

    def setUp(self):
        super().setUp()
        self.other = self.env['res.company'].create({'name': 'Voice company B'})
        self.foreign_connection = self.make_twilio(external_id=OTHER_SID, company=self.other)
        self.foreign_sender = self.env['liwan.integration.sender'].create({
            'company_id': self.other.id, 'connection_id': self.foreign_connection.id, 'channel': 'voice',
            'kind': 'number', 'value': VOICE_NUMBER, 'is_default': True,
        })
        self.foreign = self.Call.browse(self.place_with_company('_liwan_speak', self.other, to=CALLER, text='from B', origin='test')['id'])

    def place_with_company(self, method, company, **kwargs):
        service = self.Voice.with_company(company)
        with patch.object(twilio, 'create_call', return_value={'provider_call_id': OTHER_SID and CALL_SID, 'status': 'initiated'}):
            return getattr(service, method)(**kwargs)

    def test_another_company_sees_none_of_the_calls(self):
        self.login(self.logger)
        self.assertEqual(self.api('GET', f'{VOICE}/calls').json(), {'items': [], 'total': 0})
        hidden = self.api('GET', f'{VOICE}/calls/{self.foreign.id}')
        missing = self.api('GET', f'{VOICE}/calls/999999999')
        self.assertEqual((hidden.status_code, hidden.content), (404, missing.content))
        # The test routes need integrations.manage, which the log reader does not hold.
        self.assertEqual(self.api('GET', f'{VOICE}/test/{self.foreign.id}').status_code, 403)

    def test_the_log_opens_only_with_integrations_log_read(self):
        row = self.speak()
        for user in (self.admin, self.manager):
            with self.subTest(user=user.login):
                self.login(user)
                self.assertError(self.api('GET', f'{VOICE}/calls'), 403, 'forbidden')
                self.assertError(self.api('GET', f'{VOICE}/calls/{row.id}'), 403, 'forbidden')
        self.login(self.logger)
        listed = self.api('GET', f'{VOICE}/calls?state=initiated&q=50123')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()['total'], 1)
        self.assertEqual(set(listed.json()['items'][0]), CALL_KEYS)
        self.assertError(self.api('GET', f'{VOICE}/calls?state=nope'), 422, 'invalid')

    def test_an_admin_without_the_log_runs_and_watches_only_its_own_test(self):
        self.login(self.admin)
        with patch.object(twilio, 'create_call', return_value={'provider_call_id': CALL_SID, 'status': 'initiated'}):
            created = self.api('POST', f'{VOICE}/test', {'to': CALLER, 'mode': 'speak'}).json()
        self.assertEqual(set(created), STATE_KEYS)
        self.assertEqual(created['state'], 'initiated')
        self.assertEqual(self.api('GET', f'{VOICE}/test/{created["id"]}').json()['state'], 'initiated')
        self.login(self.manager)
        self.assertEqual(self.api('GET', f'{VOICE}/test/{created["id"]}').status_code, 404)
        self.login(self.logger)
        self.assertError(self.api('POST', f'{VOICE}/test', {'to': CALLER, 'mode': 'speak'}), 403, 'forbidden')

    def test_a_user_without_any_integrations_capability_places_a_call_and_reads_only_its_own_row(self):
        nobody = new_test_user(self.env, login='voice_nobody', groups='liwan_core.group_employee')
        service = self.env(user=nobody)['liwan.integration.voice']
        with patch.object(twilio, 'create_call', return_value={'provider_call_id': CALL_SID, 'status': 'initiated'}):
            state = service._liwan_speak(to=CALLER, text='from an application', origin='test')
        self.assertEqual(set(state), set(service._liwan_status(state['id'], 'test')))
        self.assertEqual(state['state'], 'initiated')
        self.assertIsNone(service._liwan_status(self.foreign.id, 'test'))
        self.assertIsNone(service._liwan_status(state['id'], 'test', requested_by=self.admin))
        for model in ('liwan.integration.call', 'liwan.integration.secret', 'liwan.integration.sender'):
            with self.subTest(model=model), self.assertRaises(AccessError):
                self.env(user=nobody)[model].search([])


@tagged('post_install', '-at_install', 'liwan')
class TestLookup(VoiceCase):

    def setUp(self):
        super().setUp()
        self.Lookup = self.env['liwan.integration.lookup']

    def lookup_answer(self, valid=True, line_type=None):
        payload = {
            'calling_country_code': '966', 'country_code': 'SA', 'phone_number': CALLER,
            'national_format': '050 123 4567', 'valid': valid, 'validation_errors': None,
            'line_type_intelligence': {'type': line_type} if line_type else None,
        }
        return answer(200, payload)

    def test_lookup_returns_validity_e164_and_country_and_line_type_only_when_asked(self):
        with twilio_http(self.lookup_answer(line_type='mobile')) as call:
            answer_value = self.Lookup._liwan_lookup(CALLER, line_type=True)
        self.assertEqual(answer_value, {'valid': True, 'e164': CALLER, 'country': 'SA', 'line_type': 'mobile'})
        self.assertEqual(call.call_args_list[0].args[1], f'https://lookups.twilio.com/v2/PhoneNumbers/{quote(CALLER, safe="")}')
        self.assertEqual(call.call_args_list[0].kwargs['params'], {'Fields': 'line_type_intelligence'})
        with twilio_http(self.lookup_answer()) as call:
            plain = self.Lookup._liwan_lookup('0501234567')
        self.assertEqual(plain, {'valid': True, 'e164': CALLER, 'country': 'SA', 'line_type': None})
        self.assertIsNone(call.call_args_list[0].kwargs['params'])

    def test_an_invalid_number_is_an_answer_not_an_error_and_nothing_is_stored(self):
        with twilio_http(answer(200, {'valid': False, 'phone_number': None, 'country_code': None, 'line_type_intelligence': None})):
            answer_value = self.Lookup._liwan_lookup(CALLER, line_type=False)
        self.assertEqual((answer_value['valid'], answer_value['country']), (False, None))
        self.assertFalse(self.Call.search([]) or self.env['liwan.integration.message'].search([]))

    def test_lookup_refuses_without_a_connection_or_with_a_provider_failure(self):
        self.connection.state = 'disabled'
        with twilio_http() as call:
            with self.assertRaises(LiwanAccessRule) as refused:
                self.Lookup._liwan_lookup(CALLER)
        self.assertEqual(refused.exception.code, 'no_connection')
        call.assert_not_called()
        self.connection.state = 'connected'
        with patch.object(twilio, 'lookup', side_effect=errors.ProviderError('Authenticate', retryable=False)):
            with self.assertRaises(LiwanAccessRule) as refused:
                self.Lookup._liwan_lookup(CALLER)
        self.assertEqual(refused.exception.code, 'lookup_failed')

    def test_the_lookup_test_route_needs_manage_and_answers_the_contract_shape(self):
        self.login(self.admin)
        with twilio_http(self.lookup_answer(line_type='mobile')):
            result = self.api('POST', f'{LOOKUP}/test', {'number': '0501234567', 'line_type': True})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {'valid': True, 'e164': CALLER, 'country': 'SA', 'line_type': 'mobile'})
        self.assertError(self.api('POST', f'{LOOKUP}/test', {'number': '0501234567', 'line_type': 'mobile'}), 422, 'invalid')
        self.assertError(self.api('POST', f'{LOOKUP}/test', {'number': 'not a number'}), 422, 'invalid_phone')
        self.login(self.logger)
        self.assertError(self.api('POST', f'{LOOKUP}/test', {'number': CALLER}), 403, 'forbidden')


@tagged('post_install', '-at_install', 'liwan')
class TestVoiceConnectionLifecycle(VoiceCase):

    def test_deleting_a_connection_with_call_rows_keeps_the_log_and_answers_in_use_while_a_call_is_pending(self):
        row = self.speak()
        self.login(self.admin)
        self.assertError(self.api('DELETE', f'{BASE}/connections/{self.connection.id}'), 409, 'in_use')
        self.assertIn('twilio.voice', self.env['liwan.integration.registry']._liwan_connection_uses(self.connection))
        row.write({'state': 'completed'})
        # An active sender still holds the connection; remove them, then the delete keeps the call rows.
        self.env['liwan.integration.sender'].search([('connection_id', '=', self.connection.id)]).unlink()
        self.assertEqual(self.api('DELETE', f'{BASE}/connections/{self.connection.id}').status_code, 204)
        row.invalidate_recordset()
        self.assertEqual((row.connection_id.id, row.provider, row.account_ref, row.from_value), (False, 'twilio', SID, VOICE_NUMBER))

    def test_an_unconfirmed_call_holds_the_connection(self):
        row = self.speak()
        row.write({'state': 'unconfirmed'})
        self.assertIn('twilio.voice', self.env['liwan.integration.registry']._liwan_connection_uses(self.connection))
        row.write({'state': 'completed'})
        self.env['liwan.integration.sender'].search([('connection_id', '=', self.connection.id)]).unlink()
        self.assertNotIn('twilio.voice', self.env['liwan.integration.registry']._liwan_connection_uses(self.connection))

    def test_an_arabic_sentence_is_spoken_with_an_arabic_voice_and_cannot_inject_twiml(self):
        text = 'أهلًا <بك> بالواجهة'
        self.place('_liwan_speak', to=CALLER, text=text, origin='test')
        twiml = self.sent[0]['twiml']
        self.assertIn('voice="Polly.Zeina"', twiml)
        self.assertIn('أهلًا &lt;بك&gt; بالواجهة', twiml)
        self.assertNotIn('<بك>', twiml)
