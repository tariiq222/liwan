# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import hmac
import json
import time

from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import OPERATOR_CONTEXT, LiwanApiCase
from odoo.addons.liwan_telephony.controllers.telephony_events import (
    EVENTS_LABEL,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    derived_key,
)
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE

MANAGER_PASSWORD = 'telephony_manager_pass_123'
PHONE_USER_PASSWORD = 'telephony_phone_user_pass_123'
# The deployment's events key root, as the operator hands it to the package and the database.
EVENTS_KEY_ROOT = 'ab' * 32
AGENT_URL = 'http://pbx-agent.test:8080'
AGENT_KEY = 'cd' * 32
PARTNER_NUMBER = '+966500000000'
LINE_NUMBERS = ('+966500000001', '+966500000002')
CALL_SHAPE = frozenset({
    'id', 'linkedid', 'direction', 'state', 'remoteNumber', 'partner', 'user', 'extension', 'startedAt',
    'answeredAt', 'endedAt', 'durationSeconds', 'recordingState', 'companyId',
})
LINE_SHAPE = frozenset({
    'id', 'name', 'kind', 'mode', 'authMethod', 'providerHost', 'providerPort', 'numbers', 'outboundFormat',
    'callerId', 'maxConcurrent',
})


def set_feature(case, key, enabled=True):
    """Switch one feature, or set one limit, on the tenant profile the way the operator does."""
    profile = case.env.ref('liwan_platform.tenant_profile')
    values = {'features': {**(profile.features or {}), key: enabled}}
    if enabled is False:
        values['retained_read_features'] = [
            item for item in (profile.retained_read_features or []) if item != key
        ]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write(values)


def envelope(event_id, linkedid='1764049999.9', database='test', **call):
    """The agent's event (contracts/src/telephony/event.ts), with ``call`` overridden by keyword."""
    return {
        'event_id': event_id,
        'database': database,
        'occurred_at': '2026-11-25T09:00:05.000000Z',
        'source': 'ari',
        'reconciled': False,
        'call': {
            'linkedid': linkedid,
            'uniqueid': linkedid,
            'channel': 'PJSIP/1001-00000001',
            'direction': 'in',
            'caller_number': '966500000000',
            'connected_number': '1001',
            'dialed_exten': '1001',
            'state': 'answered',
            'started_at': '2026-11-25T09:00:00.000000Z',
            'answered_at': '2026-11-25T09:00:05.000000Z',
            'ended_at': None,
            **call,
        },
    }


class LiwanTelephonyCase(LiwanApiCase):
    """The shared liwan_api fixture plus a telephony manager, a phone user, a customer, a line, extensions and a
    call.

    ``manager`` holds the four telephony capabilities in the main company; ``phone_user`` holds ``telephony.use``
    alone, so the own-calls rule is what decides what each of them sees.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.manager = new_test_user(
            cls.env, login='telephony_manager', password=MANAGER_PASSWORD,
            name='Telephony Manager', groups='liwan_core.group_employee',
        )
        cls.phone_user = new_test_user(
            cls.env, login='telephony_phone_user', password=PHONE_USER_PASSWORD,
            name='Phone User', groups='liwan_core.group_employee',
        )
        service = cls.env['liwan.access.service']
        service._liwan_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('liwan_telephony.role_telephony_manager').id, 'company_id': cls.company.id,
        }])
        service._liwan_replace_assignments(cls.phone_user, [{
            'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': cls.company.id,
        }])
        cls.outsider = new_test_user(
            cls.env, login='telephony_outsider', password='telephony_outsider_pass_123',
            name='No Telephony access', groups='base.group_user',
        )
        cls.partner = cls.env['res.partner'].create({
            'name': 'Alia Customer', 'is_company': True, 'phone': PARTNER_NUMBER,
        })
        cls.line = cls.env['liwan.telephony.line'].create({
            'name': 'Main trunk',
            'kind': 'sip_trunk',
            'auth_method': 'credentials',
            'provider_host': 'sip.provider.test',
            'number_ids': [(0, 0, {'number': number}) for number in LINE_NUMBERS],
        })
        cls.extension = cls.env['liwan.telephony.extension'].create({
            'number': '1001', 'user_id': cls.manager.id,
        })
        cls.spare_extension = cls.env['liwan.telephony.extension'].create({'number': '1002'})
        cls.call = cls.env['liwan.telephony.call'].create({
            'linkedid': '1764049999.1',
            'direction': 'in',
            'state': 'answered',
            'remote_number': PARTNER_NUMBER,
            'extension_number': '1001',
            'partner_id': cls.partner.id,
            'extension_id': cls.extension.id,
            'user_id': cls.manager.id,
            'started_at': '2026-11-25 09:00:00',
            'answered_at': '2026-11-25 09:00:05',
            'ended_at': '2026-11-25 09:02:05',
        })
        cls.events_user = cls.env.ref('liwan_telephony.user_telephony_events')

    def sign_in(self, user, password):
        self.authenticate(user.login, password)

    def set_agent(self, url=AGENT_URL, reverse_key=AGENT_KEY, key_root=None):
        """Name the company's agent the way the deployment does."""
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('liwan.telephony.agent_url', url)
        if key_root is not None:
            params.set_param('liwan.telephony.events_key_root', key_root)
        if reverse_key is not None:
            params.set_param('liwan.telephony.reverse_key', reverse_key)

    def patch_agent(self, handler):
        """Replace ``_liwan_send`` on ``liwan.telephony.agent`` with ``handler(method, url, payload, headers)``."""
        agent = type(self.env['liwan.telephony.agent'])
        self.patch(
            agent,
            '_liwan_send',
            lambda _model, method, url, payload, headers: handler(method, url, payload, headers),
        )


class LiwanTelephonyEventsCase(LiwanTelephonyCase):
    """The feature and the events key on, to post events signed exactly as the agent signs them."""

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.env['ir.config_parameter'].sudo().set_param('liwan.telephony.events_key_root', EVENTS_KEY_ROOT)

    def make_envelope(self, event_id, linkedid='1764049999.9', **call):
        """Build an event envelope targeting this test database."""
        return envelope(event_id, linkedid=linkedid, database=self.env.cr.dbname, **call)

    def event_headers(self, payload, when=None, signature=None):
        """The two proof headers over the agent's exact bytes: sorted keys, no spaces, UTF-8 kept."""
        when = int(time.time()) if when is None else when
        body = self.event_body(payload)
        key = derived_key(EVENTS_KEY_ROOT, self.env.cr.dbname, EVENTS_LABEL)
        expected = signature if signature is not None else hmac.new(
            bytes.fromhex(key), str(when).encode() + b'\n' + body, hashlib.sha256,
        ).hexdigest()
        return {TIMESTAMP_HEADER: str(when), SIGNATURE_HEADER: expected}

    def event_body(self, payload):
        return json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')

    def post_event(self, payload, when=None, signature=None, headers=None):
        """Post ``payload`` as the agent does. ``headers`` replaces the two proof headers entirely."""
        sent = self.event_headers(payload, when=when, signature=signature) if headers is None else headers
        return self.url_open(
            '/api/v1/telephony/events',
            data=self.event_body(payload),
            headers={'Content-Type': 'application/json', **sent},
            method='POST',
        )
