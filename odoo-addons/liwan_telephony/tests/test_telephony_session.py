# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Reverse-signed agent calls, browser session lifecycle and extension PATCH (design 4.1, 12.6)."""
import io
import json
import urllib.error

from odoo.tests import tagged

from .common import (
    AGENT_KEY,
    AGENT_URL,
    EVENTS_KEY_ROOT,
    MANAGER_PASSWORD,
    PHONE_USER_PASSWORD,
    LiwanTelephonyCase,
    derived_key,
    set_feature,
)
from .test_telephony_calls import API_LOGGER, assert_refused
from odoo.addons.liwan_telephony.models.agent_client import (
    AGENT_BAD_ANSWER,
    AGENT_NOT_CONFIGURED,
    AGENT_UNREACHABLE,
    DATABASE_HEADER,
    REVERSE_LABEL,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    _liwan_sign_reverse,
)
from odoo.addons.liwan_telephony.models.feature_registry import (
    EVENTS_FEATURE,
    EXTENSIONS_LIMIT,
)

SESSION = '/api/v1/telephony/session'
EXTENSIONS = '/api/v1/telephony/extensions'
# Shared reverse-signing test vector (design 12.6), mirrored in apps/pbx-agent.
VECTOR_KEY = '01' * 32
VECTOR_TIMESTAMP = '1700000000'
VECTOR_METHOD = 'POST'
VECTOR_PATH = '/registration'
VECTOR_BODY = b'{"database":"liwan_acme","extension":"101"}'
VECTOR_DIGEST = '7ec49cf1d3253e1a030372f29a059d41b6de3577a419428dc0acd955a915236b'


def _valid_session_reply(**overrides):
    return {
        'ws_url': 'wss://pbx.test/ws',
        'auth_username': '1001-session',
        'password': 'ephemeral-password',
        'ice_servers': [
            {'urls': 'stun:stun.test:3478'},
            {'urls': ['turn:turn.test:3478?transport=udp'], 'username': 'u1', 'credential': 'c1'},
        ],
        'expires_in_seconds': 90,
        **overrides,
    }


def _http_error(code, body=b'upstream secret detail'):
    return urllib.error.HTTPError(
        'http://pbx-agent.internal:8080/secret', code, 'err', {}, io.BytesIO(body),
    )


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonySession(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def test_shared_reverse_signing_vector(self):
        self.assertEqual(
            _liwan_sign_reverse(VECTOR_KEY, VECTOR_TIMESTAMP, VECTOR_METHOD, VECTOR_PATH, VECTOR_BODY),
            VECTOR_DIGEST,
        )

    def test_create_session_signs_with_reverse_key_and_returns_contract_shape(self):
        self.set_agent()
        sent = []

        def handler(method, url, payload, headers):
            sent.append((method, url, payload, headers))
            return _valid_session_reply()

        self.patch_agent(handler)
        response = self.api('POST', SESSION, json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            'wsUrl': 'wss://pbx.test/ws',
            'extension': '1001',
            'authUsername': '1001-session',
            'password': 'ephemeral-password',
            'iceServers': [
                {'urls': 'stun:stun.test:3478'},
                {'urls': ['turn:turn.test:3478?transport=udp'], 'username': 'u1', 'credential': 'c1'},
            ],
            'expiresInSeconds': 90,
        })
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        self.assertEqual((method, url), ('POST', f'{AGENT_URL}/registration'))
        self.assertEqual(
            payload,
            json.dumps(
                {'database': self.env.cr.dbname, 'extension': '1001'},
                sort_keys=True, separators=(',', ':'), ensure_ascii=False,
            ).encode('utf-8'),
        )
        self.assertEqual(headers['Content-Type'], 'application/json')
        self.assertEqual(headers[DATABASE_HEADER], self.env.cr.dbname)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'POST', '/registration', payload),
        )

    def test_events_key_root_derives_reverse_key_and_invalid_keys_stay_unconfigured(self):
        self.set_agent(reverse_key=AGENT_KEY, key_root=EVENTS_KEY_ROOT)
        sent = []
        self.patch_agent(lambda method, url, payload, headers: (
            sent.append((method, url, payload, headers)) or _valid_session_reply()
        ))
        response = self.api('POST', SESSION, json={})
        self.assertEqual(response.status_code, 200, response.text)
        _, _, payload, headers = sent[0]
        expected_key = derived_key(EVENTS_KEY_ROOT, self.env.cr.dbname, REVERSE_LABEL)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(expected_key, headers[TIMESTAMP_HEADER], 'POST', '/registration', payload),
        )
        # Non-64-hex root and reverse key are treated as unconfigured (503).
        self.set_agent(reverse_key='not-hex', key_root='also-not-hex')
        unconfigured = self.api('POST', SESSION, json={})
        assert_refused(self, unconfigured, 503, 'unavailable')
        self.assertEqual(unconfigured.json()['message'], AGENT_NOT_CONFIGURED)

    def test_create_session_gates_missing_extension_and_capability_and_feature(self):
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        assert_refused(self, self.api('POST', SESSION, json={}), 404, 'not_found')
        self.authenticate('telephony_outsider', 'telephony_outsider_pass_123')
        assert_refused(self, self.api('POST', SESSION, json={}), 403, 'forbidden')
        self.sign_in(self.manager, MANAGER_PASSWORD)
        set_feature(self, EVENTS_FEATURE, False)
        assert_refused(self, self.api('POST', SESSION, json={}), 403, 'feature_not_included')

    def test_create_session_maps_agent_errors_and_malformed_replies(self):
        unconfigured = self.api('POST', SESSION, json={})
        assert_refused(self, unconfigured, 503, 'unavailable')
        self.assertEqual(unconfigured.json()['message'], AGENT_NOT_CONFIGURED)
        self.set_agent()

        # Network error -> 503 with fixed message, never leaking host/detail.
        def network_fail(method, url, payload, headers):
            reason = 'pbx-agent.internal refused'
            raise urllib.error.URLError(reason)

        self.patch_agent(network_fail)
        with self.assertNoLogs(API_LOGGER, 'ERROR'):
            failed = self.api('POST', SESSION, json={})
        assert_refused(self, failed, 503, 'unavailable')
        self.assertEqual(failed.json()['message'], AGENT_UNREACHABLE)
        self.assertNotIn('pbx-agent.internal', failed.text)

        # HTTP 500 -> 503, HTTP 401/403 -> 502, never leaking upstream body.
        for status_code, expected_status, expected_code in (
            (500, 503, 'unavailable'),
            (502, 503, 'unavailable'),
            (401, 502, 'bad_gateway'),
            (403, 502, 'bad_gateway'),
        ):
            def http_fail(method, url, payload, headers, code=status_code):
                raise _http_error(code)

            self.patch_agent(http_fail)
            res = self.api('POST', SESSION, json={})
            assert_refused(self, res, expected_status, expected_code)
            self.assertNotIn('upstream secret detail', res.text)
            self.assertNotIn('pbx-agent.internal', res.text)

        # Malformed session payloads -> 502 bad_gateway.
        bad_replies = (
            [],
            _valid_session_reply(ws_url='https://pbx.test/ws'),
            _valid_session_reply(ws_url='wss://'),
            _valid_session_reply(auth_username=''),
            _valid_session_reply(auth_username='a' * 65),
            _valid_session_reply(password=''),
            _valid_session_reply(expires_in_seconds=0),
            _valid_session_reply(expires_in_seconds=121),
            _valid_session_reply(expires_in_seconds='60'),
            _valid_session_reply(expires_in_seconds=True),
            _valid_session_reply(expires_in_seconds=None),
            _valid_session_reply(ice_servers='turn:turn.test'),
            _valid_session_reply(ice_servers=None),
            _valid_session_reply(ice_servers=[{'urls': ''}]),
            _valid_session_reply(ice_servers=[{'urls': []}]),
            _valid_session_reply(ice_servers=[{'urls': 'turn:t', 'username': ''}]),
            _valid_session_reply(ice_servers=[{'urls': 'turn:t', 'extra': 'no'}]),
        )
        for bad in bad_replies:
            self.patch_agent(lambda method, url, payload, headers, reply=bad: reply)
            res = self.api('POST', SESSION, json={})
            assert_refused(self, res, 502, 'bad_gateway')
            self.assertEqual(res.json()['message'], AGENT_BAD_ANSWER)

    def test_delete_session_revokes_signed_and_is_idempotent_without_extension(self):
        # User without an extension gets revoked: False even when agent is unconfigured.
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        none_res = self.api('DELETE', SESSION)
        self.assertEqual((none_res.status_code, none_res.json()), (200, {'revoked': False}))

        # Unauthorized caller gets 403.
        self.authenticate('telephony_outsider', 'telephony_outsider_pass_123')
        assert_refused(self, self.api('DELETE', SESSION), 403, 'forbidden')

        # Manager with extension revokes via signed DELETE /registration/<ext> with empty body.
        self.sign_in(self.manager, MANAGER_PASSWORD)
        self.set_agent()
        sent = []
        self.patch_agent(lambda method, url, payload, headers: (
            sent.append((method, url, payload, headers)) or {}
        ))
        revoked = self.api('DELETE', SESSION)
        self.assertEqual((revoked.status_code, revoked.json()), (200, {'revoked': True}))
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        self.assertEqual((method, url, payload), ('DELETE', f'{AGENT_URL}/registration/1001', b''))
        self.assertNotIn('Content-Type', headers)
        self.assertEqual(headers[DATABASE_HEADER], self.env.cr.dbname)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'DELETE', '/registration/1001', b''),
        )

        # Closed feature answers 403.
        set_feature(self, EVENTS_FEATURE, False)
        assert_refused(self, self.api('DELETE', SESSION), 403, 'feature_not_included')


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyExtensionPatch(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def patch_ext(self, extension_id, **payload):
        return self.api('PATCH', f'{EXTENSIONS}/{extension_id}', json=payload)

    def test_disable_and_reenable_notify_agent_and_enforce_limit(self):
        self.set_agent()
        sent = []
        self.patch_agent(lambda method, url, payload, headers: (
            sent.append((method, url, payload, headers)) or {'ok': True}
        ))

        # Disable spare_extension (1002): sends DELETE /extensions/1002 with empty body.
        disabled = self.patch_ext(self.spare_extension.id, active=False)
        self.assertEqual(disabled.status_code, 200, disabled.text)
        self.assertEqual(disabled.json(), {
            'id': self.spare_extension.id, 'number': '1002', 'user': None, 'active': False,
        })
        self.assertFalse(self.spare_extension.active)
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        self.assertEqual((method, url, payload), ('DELETE', f'{AGENT_URL}/extensions/1002', b''))
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'DELETE', '/extensions/1002', b''),
        )

        # Re-enabling respects telephony.extensions limit: with limit=1 (1001 is active), 1002 cannot re-enable.
        set_feature(self, EXTENSIONS_LIMIT, 1)
        blocked = self.patch_ext(self.spare_extension.id, active=True)
        self.assertEqual(blocked.status_code, 403, blocked.text)
        self.assertEqual(blocked.json()['code'], 'feature_not_included')
        self.assertFalse(self.spare_extension.active)
        self.assertEqual(len(sent), 1)  # Agent was NOT called when limit refused.

        # Raising limit to 2 allows re-enabling 1002 and notifies agent with PUT /extensions/1002.
        set_feature(self, EXTENSIONS_LIMIT, 2)
        reenabled = self.patch_ext(self.spare_extension.id, active=True, userId=self.phone_user.id)
        self.assertEqual(reenabled.status_code, 200, reenabled.text)
        self.assertEqual(reenabled.json(), {
            'id': self.spare_extension.id,
            'number': '1002',
            'user': {'id': self.phone_user.id, 'name': self.phone_user.name},
            'active': True,
        })
        self.assertTrue(self.spare_extension.active)
        self.assertEqual(len(sent), 2)
        method, url, payload, headers = sent[1]
        self.assertEqual((method, url), ('PUT', f'{AGENT_URL}/extensions/1002'))
        self.assertEqual(json.loads(payload), {'database': self.env.cr.dbname, 'active': True})
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'PUT', '/extensions/1002', payload),
        )

        # Reassigning userId on an active extension revokes the previous user's live SIP registration.
        reassigned = self.patch_ext(self.spare_extension.id, userId=self.manager.id)
        self.assertEqual((reassigned.status_code, reassigned.json()['user']['id']), (200, self.manager.id))
        self.assertEqual(len(sent), 3)
        method, url, payload, headers = sent[2]
        self.assertEqual((method, url, payload), ('DELETE', f'{AGENT_URL}/registration/1002', b''))
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'DELETE', '/registration/1002', b''),
        )

        # Clearing userId on an active extension also revokes the previous user's live SIP registration.
        cleared = self.patch_ext(self.spare_extension.id, userId=None)
        self.assertEqual((cleared.status_code, cleared.json()['user']), (200, None))
        self.assertEqual(len(sent), 4)
        self.assertEqual(sent[3][:3], ('DELETE', f'{AGENT_URL}/registration/1002', b''))

        # No-op userId=None or initial assignment from None does not call the agent.
        noop = self.patch_ext(self.spare_extension.id, userId=None)
        self.assertEqual(noop.status_code, 200)
        initial = self.patch_ext(self.spare_extension.id, userId=self.phone_user.id)
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(len(sent), 4)

    def test_patch_refused_by_read_only_guard_never_calls_agent(self):
        self.set_agent()
        sent = []
        self.patch_agent(lambda method, url, payload, headers: sent.append((method, url)) or {'ok': True})
        entitlement = self.env['liwan.entitlement.service']
        entitlement._liwan_apply_flags(self.manager, {'liwan_read_only': True})
        try:
            refused = self.patch_ext(self.spare_extension.id, active=False)
            assert_refused(self, refused, 403, 'user_read_only')
            self.assertEqual(sent, [])
            self.assertTrue(self.spare_extension.active)
        finally:
            entitlement._liwan_apply_flags(self.manager, {'liwan_read_only': False})

    def test_disable_and_reenable_fail_closed_when_agent_unreachable(self):
        self.set_agent()

        def fail(method, url, payload, headers):
            reason = 'agent unreachable'
            raise urllib.error.URLError(reason)

        self.patch_agent(fail)
        res = self.patch_ext(self.spare_extension.id, active=False)
        assert_refused(self, res, 503, 'unavailable')
        self.assertTrue(self.spare_extension.active)

        # Archive directly in DB, then verify re-enable also fails closed on 503.
        self.spare_extension.active = False
        res2 = self.patch_ext(self.spare_extension.id, active=True)
        assert_refused(self, res2, 503, 'unavailable')
        self.assertFalse(self.spare_extension.active)

    def test_patch_validation_cross_company_404_and_capability_gate(self):
        # Cross-company extension answers identical 404 to a missing id.
        branch = self.env['res.company'].create({'name': 'Other branch', 'parent_id': self.company.id})
        other = self.env['liwan.telephony.extension'].create({'number': '2009', 'company_id': branch.id})
        missing = self.patch_ext(999999999, active=False)
        foreign = self.patch_ext(other.id, active=False)
        self.assertEqual((foreign.status_code, foreign.content), (404, missing.content))

        # Unknown keys and wrong types answer 422 naming the field.
        for payload, field in (
            ({'number': '9999'}, 'number'),
            ({'password': 'x'}, 'password'),
            ({'active': 'false'}, 'active'),
            ({'active': 0}, 'active'),
            ({'active': 1}, 'active'),
            ({'active': None}, 'active'),
            ({'userId': 0}, 'userId'),
            ({'userId': '1'}, 'userId'),
            ({'userId': True}, 'userId'),
        ):
            assert_refused(self, self.patch_ext(self.spare_extension.id, **payload), 422, 'invalid', field)

        # Non-manager answers 403.
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        assert_refused(self, self.patch_ext(self.spare_extension.id, active=False), 403, 'forbidden')
