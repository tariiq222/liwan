# Part of Odoo. See LICENSE file for full copyright and licensing details.
import urllib.error

from odoo.fields import Command
from odoo.tests import tagged

from .common import (
    CALL_SHAPE,
    MANAGER_PASSWORD,
    PARTNER_NUMBER,
    PHONE_USER_PASSWORD,
    LiwanTelephonyCase,
    set_feature,
)
from odoo.addons.liwan_telephony.controllers.telephony_calls import LOOKUP_CALLS
from odoo.addons.liwan_telephony.models.agent_client import (
    AGENT_NOT_CONFIGURED,
    AGENT_UNREACHABLE,
)
from odoo.addons.liwan_telephony.models.feature_registry import (
    EVENTS_FEATURE,
    RECORDING_FEATURE,
)

CALLS = '/api/v1/telephony/calls'
LOOKUP = '/api/v1/telephony/lookup'
SESSION = '/api/v1/telephony/session'
# Where api_handler logs a traceback of a controller it had to turn into a 500.
API_LOGGER = 'odoo.addons.liwan_api.controllers.common'


def assert_refused(test, result, status, code, field=None):
    body = result.json()
    test.assertEqual((result.status_code, body['code']), (status, code), result.text)
    test.assertEqual(body.get('field'), field, result.text)
    return body


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyCalls(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        set_feature(self, RECORDING_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def create_call(self, linkedid, **values):
        return self.env['liwan.telephony.call'].create({
            'linkedid': linkedid, 'direction': 'out', 'state': 'ended', 'remote_number': '+966500000001',
            'started_at': '2026-11-26 10:00:00', 'answered_at': '2026-11-26 10:00:03',
            'ended_at': '2026-11-26 10:01:00', **values,
        })

    def call_item(self, call_id):
        """The call as the lookup card lists it: the list item, which carries no ``canListen``."""
        body = self.api('GET', f'{CALLS}/{call_id}').json()
        return {key: value for key, value in body.items() if key != 'canListen'}

    def test_the_detail_is_the_target_shape_with_can_listen(self):
        body = self.api('GET', f'{CALLS}/{self.call.id}').json()
        self.assertEqual(set(body), CALL_SHAPE | {'canListen'})
        self.assertEqual(body, {
            'id': self.call.id, 'linkedid': '1764049999.1', 'direction': 'in', 'state': 'answered',
            'remoteNumber': PARTNER_NUMBER,
            'partner': {'id': self.partner.id, 'name': self.partner.display_name},
            'user': {'id': self.manager.id, 'name': self.manager.name},
            'extension': {'id': self.extension.id, 'name': '1001'},
            'startedAt': '2026-11-25T09:00:00Z', 'answeredAt': '2026-11-25T09:00:05Z',
            'endedAt': '2026-11-25T09:02:05Z', 'durationSeconds': 125, 'recordingState': 'none',
            'companyId': self.company.id, 'canListen': True,
        })
        result = self.api('GET', f'{CALLS}/999999999')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))

    def test_the_list_reads_its_filters_from_the_query_string(self):
        other = self.create_call('1764050000.2', state='failed', started_at='2026-11-24 08:00:00')
        listed = self.api('GET', CALLS).json()
        self.assertEqual(set(listed), {'items', 'total'})
        self.assertEqual([item['linkedid'] for item in listed['items']], ['1764049999.1', '1764050000.2'])
        self.assertEqual(set(listed['items'][0]), CALL_SHAPE)
        self.assertEqual(listed['total'], 2)
        page = self.api('GET', f'{CALLS}?limit=1&offset=1').json()
        self.assertEqual(([item['id'] for item in page['items']], page['total']), ([other.id], 2))
        self.assertEqual(self.api('GET', f'{CALLS}?direction=in').json()['total'], 1)
        self.assertEqual(self.api('GET', f'{CALLS}?state=failed').json()['items'][0]['id'], other.id)
        self.assertEqual(self.api('GET', f'{CALLS}?state=ringing').json()['total'], 0)
        self.assertEqual(self.api('GET', f'{CALLS}?state=rejected').json()['total'], 0)
        self.assertEqual(self.api('GET', f'{CALLS}?user_id={self.manager.id}').json()['items'][0]['id'], self.call.id)
        for query, field in (
            ('direction=sideways', 'direction'), ('state=talking', 'state'),
            ('user_id=abc', 'user_id'), ('user_id=0', 'user_id'),
        ):
            assert_refused(self, self.api('GET', f'{CALLS}?{query}'), 422, 'invalid', field)

    def test_a_use_only_user_sees_their_own_calls_and_a_manager_sees_all(self):
        mine = self.create_call('1764050000.3', state='missed', user_id=self.phone_user.id)
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        listed = self.api('GET', CALLS).json()
        self.assertEqual(([item['id'] for item in listed['items']], listed['total']), ([mine.id], 1))
        # A colleague's call answers exactly like a missing one.
        hidden = self.api('GET', f'{CALLS}/{self.call.id}')
        self.assertEqual((hidden.status_code, hidden.content), (404, self.api('GET', f'{CALLS}/999999999').content))
        self.assertEqual(self.api('GET', f'{CALLS}?user_id={self.manager.id}').json()['total'], 0)
        self.sign_in(self.manager, MANAGER_PASSWORD)
        self.assertEqual(self.api('GET', CALLS).json()['total'], 2)
        self.assertEqual(self.api('GET', f'{CALLS}/{mine.id}').status_code, 200)
        self.authenticate('telephony_outsider', 'telephony_outsider_pass_123')
        assert_refused(self, self.api('GET', CALLS), 403, 'forbidden')

    def test_the_lookup_matches_the_normalized_number(self):
        national = self.api('GET', f'{LOOKUP}?number=0500000000')
        self.assertEqual(national.status_code, 200, national.text)
        self.assertEqual(national.json(), {
            'number': PARTNER_NUMBER,
            'partner': {
                'id': self.partner.id, 'name': self.partner.display_name, 'isCompany': True, 'company': None,
            },
            'calls': [self.call_item(self.call.id)],
        })
        unknown = self.api('GET', f'{LOOKUP}?number=%2B966511111111').json()
        self.assertEqual((unknown['number'], unknown['partner'], unknown['calls']), ('+966511111111', None, []))
        for index in range(LOOKUP_CALLS + 1):
            self.create_call(f'1764060000.{index}', remote_number='+966511111111', direction='in',
                             state='answered', user_id=self.manager.id,
                             started_at=f'2026-12-01 10:0{index}:00', ended_at=f'2026-12-01 10:0{index}:30')
        history = self.api('GET', f'{LOOKUP}?number=%2B966511111111').json()['calls']
        self.assertEqual([call['linkedid'] for call in history], [f'1764060000.{index}' for index in range(5, 0, -1)])
        assert_refused(self, self.api('GET', LOOKUP), 422, 'invalid', 'number')
        assert_refused(self, self.api('GET', f'{LOOKUP}?number='), 422, 'invalid', 'number')
        assert_refused(self, self.api('GET', f'{LOOKUP}?number=abc'), 422, 'invalid', 'number')

    def test_a_closed_feature_answers_403(self):
        set_feature(self, EVENTS_FEATURE, False)
        for path in (
            CALLS, f'{CALLS}/{self.call.id}', f'{LOOKUP}?number=%2B966500000000', f'{CALLS}/{self.call.id}/recording',
        ):
            result = self.api('GET', path)
            self.assertEqual((result.status_code, result.json()['code']), (403, 'feature_not_included'), path)

    def test_the_recording_sub_feature_off_answers_403_and_can_listen_is_false(self):
        self.call.recording_state = 'available'
        set_feature(self, RECORDING_FEATURE, False)
        assert_refused(self, self.api('GET', f'{CALLS}/{self.call.id}/recording'), 403, 'feature_not_included')
        self.assertFalse(self.api('GET', f'{CALLS}/{self.call.id}').json()['canListen'])

    def test_the_recording_link_needs_the_listen_capability_and_a_visible_call(self):
        self.call.recording_state = 'available'
        link = f'{CALLS}/{self.call.id}/recording'
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        assert_refused(self, self.api('GET', link), 403, 'forbidden')
        self.authenticate('telephony_outsider', 'telephony_outsider_pass_123')
        assert_refused(self, self.api('GET', link), 403, 'forbidden')
        # Listening is its own capability: with it, a call the own-calls rule hides is still not-found.
        permissions = self.env['liwan.access.permission'].search([
            ('key', 'in', ['telephony.use', 'telephony.recordings.listen']),
        ])
        listener = self.env['liwan.access.role'].create({
            'key': 'telephony_listener', 'name_ar': 'Listener', 'name_en': 'Listener', 'type': 'custom',
            'company_id': self.company.id, 'permission_ids': [Command.set(permissions.ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(self.phone_user, [
            {'role_id': self.env.ref('liwan_core.role_employee').id, 'company_id': self.company.id},
            {'role_id': listener.id, 'company_id': self.company.id},
        ])
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        hidden = self.api('GET', link)
        self.assertEqual((hidden.status_code, hidden.json()['code']), (404, 'not_found'), hidden.text)

    def test_the_agent_failures_answer_fixed_messages(self):
        self.call.recording_state = 'available'
        link = f'{CALLS}/{self.call.id}/recording'
        unconfigured = self.api('GET', link)
        assert_refused(self, unconfigured, 503, 'unavailable')
        self.assertEqual(unconfigured.json()['message'], AGENT_NOT_CONFIGURED)
        self.set_agent()
        agent = type(self.env['liwan.telephony.agent'])

        def failing(agent_model, url, payload, key):
            message = 'secret-host-internal: refused'
            raise urllib.error.URLError(message)

        self.patch(agent, '_liwan_post', failing)
        with self.assertNoLogs(API_LOGGER, 'ERROR'):
            failed = self.api('GET', link)
        assert_refused(self, failed, 503, 'unavailable')
        self.assertEqual(failed.json()['message'], AGENT_UNREACHABLE)
        self.assertNotIn('secret-host-internal', failed.text)
        self.patch(agent, '_liwan_post', lambda agent_model, url, payload, key: {'link': 'https://x'})
        assert_refused(self, self.api('GET', link), 502, 'bad_gateway')
        self.assertFalse(self.env['liwan.telephony.recording.access'].search([('call_id', '=', self.call.id)]))

    def test_the_session_needs_an_extension_and_a_configured_agent(self):
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        self.assertEqual(self.api('POST', SESSION, json={}).status_code, 404)
        self.sign_in(self.manager, MANAGER_PASSWORD)
        unconfigured = self.api('POST', SESSION, json={})
        self.assertEqual((unconfigured.status_code, unconfigured.json()['message']), (503, AGENT_NOT_CONFIGURED))
        self.set_agent()
        agent = type(self.env['liwan.telephony.agent'])
        self.patch(agent, '_liwan_post', lambda agent_model, url, payload, key: {'ws_url': '', 'password': 'x'})
        assert_refused(self, self.api('POST', SESSION, json={}), 502, 'bad_gateway')
        self.patch(agent, '_liwan_post', lambda agent_model, url, payload, key: {
            'ws_url': 'wss://pbx.test/ws', 'password': 'once', 'ice_servers': [{'urls': 'turn:turn.test'}],
            'expires_in_seconds': 90,
        })
        self.assertEqual(self.api('POST', SESSION, json={}).json(), {
            'wsUrl': 'wss://pbx.test/ws', 'extension': '1001', 'password': 'once',
            'iceServers': [{'urls': 'turn:turn.test'}], 'expiresInSeconds': 90,
        })
