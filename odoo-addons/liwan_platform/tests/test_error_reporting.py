# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import logging
import os
import sys
from unittest import mock

import sentry_sdk
from sentry_sdk.transport import Transport

from odoo.tests import HttpCase, TransactionCase, get_db_name, new_test_user, tagged

from odoo.addons.liwan_platform.error_reporting import (
    DSN_ENV,
    ENVIRONMENT_ENV,
    EventContext,
    init_error_reporting,
    scrub_event,
)

DSN = 'https://publickey@sentry.example.invalid/1'
API_LOGGER = 'odoo.addons.liwan_api.controllers.common'
ME_SERIALIZER = 'odoo.addons.liwan_api.controllers.me.dump_me'

# Values that must never reach a Sentry payload. They sit here, far from the code that raises, because the SDK sends the
# source lines around each frame.
COOKIE = 'fixture_cookie'
COOKIE_VALUE = 'COOKIEVALUE-4411'
ACCESS_TOKEN = 'ACCESSTOKEN-9931'
LOCAL_VALUE = 'LOCALVAR-7782'
BODY_VALUE = 'Asia/Riyadh'
PHONE = '0551234567'
EMAIL = 'ahmed.private@example.com'
IBAN = 'SA0380000000608010167519'
NATIONAL_ID = '1000000008'
LEAKS = (COOKIE_VALUE, ACCESS_TOKEN, LOCAL_VALUE, BODY_VALUE, PHONE, EMAIL, IBAN, NATIONAL_ID)
FAILURE = f'sync failed for {EMAIL} phone {PHONE} iban {IBAN} id {NATIONAL_ID} at /book/4?access_token={ACCESS_TOKEN}'


def fail_with_private_values(user):
    held = LOCAL_VALUE  # a local the SDK must not send with the frame
    if not held:
        return
    raise RuntimeError(FAILURE)


class CapturingTransport(Transport):
    """Keeps every envelope in memory so a test reads the payload the SDK would send; nothing leaves the process."""

    def __init__(self):
        super().__init__()
        self.payloads = []
        self.events = []

    def capture_envelope(self, envelope):
        self.payloads.append(envelope.serialize().decode())
        self.events.append(envelope.get_event())


@tagged('post_install', '-at_install', 'liwan')
class TestErrorReportingSwitch(TransactionCase):
    """Reporting is off unless a DSN asks for it, and a DSN without the SDK stops the start."""

    def test_without_a_dsn_the_sdk_is_never_imported(self):
        for value in (None, '', '   '):
            with self.subTest(dsn=value):
                # A None entry makes ``import sentry_sdk`` raise, so a return without error proves no import happened.
                with mock.patch.dict('os.environ'), mock.patch.dict(sys.modules, {'sentry_sdk': None}):
                    os.environ.pop(DSN_ENV, None)
                    if value is not None:
                        os.environ[DSN_ENV] = value
                    self.assertFalse(init_error_reporting())

    def test_a_dsn_without_the_sdk_raises_at_start(self):
        with mock.patch.dict('os.environ', {DSN_ENV: DSN}), mock.patch.dict(sys.modules, {'sentry_sdk': None}):
            with self.assertRaisesRegex(RuntimeError, 'sentry-sdk'):
                init_error_reporting()


@tagged('post_install', '-at_install', 'liwan')
class TestEventScrubber(TransactionCase):
    """``scrub_event`` keeps the allowed fields and withholds every private value in the text that remains."""

    def _event(self):
        return {
            'level': 'error',
            'logger': API_LOGGER,
            'server_name': 'private-host',
            'extra': {'body': 'BODYSECRET', 'phone': PHONE},
            'breadcrumbs': {'values': [{'message': EMAIL}]},
            'modules': {'odoo': '19.0'},
            'request': {
                'method': 'PATCH', 'url': f'https://tenant.example/api/v1/me/profile?access_token={ACCESS_TOKEN}',
                'query_string': f'access_token={ACCESS_TOKEN}', 'data': {'tz': BODY_VALUE},
                'cookies': {COOKIE: COOKIE_VALUE}, 'env': {'REMOTE_ADDR': '10.0.0.9'},
                'headers': {'Cookie': f'{COOKIE}={COOKIE_VALUE}', 'Authorization': 'Bearer abc', 'User-Agent': 'x'},
            },
            'user': {'id': '7', 'email': EMAIL, 'username': 'ahmed', 'ip_address': '10.0.0.9'},
            'message': FAILURE,
            'logentry': {
                'message': 'api internal error: %s %s', 'formatted': f'api internal error: {FAILURE}',
                'params': ('PATCH', f'/book/4?access_token={ACCESS_TOKEN} {PHONE}'),
            },
            'exception': {'values': [{'type': 'RuntimeError', 'value': FAILURE}]},
        }

    def test_only_the_allowed_request_user_and_tags_remain(self):
        context = EventContext('tenant_a', 'PATCH', '/book/4', 'Mozilla/5.0', 7)
        event = scrub_event(self._event(), context)
        self.assertEqual(event['request'], {
            'method': 'PATCH', 'url': '/book/4', 'headers': {'User-Agent': 'Mozilla/5.0'},
        })
        self.assertEqual(event['user'], {'id': '7'})
        self.assertEqual(event['tags'], {'runtime': 'odoo', 'tenant_db': 'tenant_a'})
        for section in ('extra', 'breadcrumbs', 'modules', 'server_name'):
            self.assertNotIn(section, event)
        serialized = json.dumps(event)
        for leak in (*LEAKS, 'BODYSECRET', '10.0.0.9', 'Bearer abc', 'ahmed'):
            self.assertNotIn(leak, serialized)
        self.assertIn('[email withheld]', event['exception']['values'][0]['value'])
        self.assertIn('access_token=***', event['exception']['values'][0]['value'])
        self.assertEqual(event['logentry']['params'][0], 'PATCH')

    def test_a_path_token_is_masked_and_a_worker_without_a_request_keeps_no_request_or_user(self):
        masked = scrub_event(self._event(), EventContext('tenant_a', 'GET', '/api/v1/public/inbox/catalog/images/3/tok-en', None, None))
        self.assertEqual(masked['request']['url'], '/api/v1/public/inbox/catalog/images/3/***')
        cron = scrub_event(self._event(), EventContext(None, None, None, None, None))
        self.assertNotIn('request', cron)
        self.assertNotIn('user', cron)
        self.assertEqual(cron['tags'], {'runtime': 'odoo'})


@tagged('post_install', '-at_install', 'liwan')
class TestErrorReportingEndToEnd(HttpCase):
    """With a DSN and an in-memory transport, one unexpected API failure makes one clean event and a handled refusal none."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())
        new_test_user(cls.env, login='sentry_emp', password='sentry_emp_pass_123', groups='liwan_core.group_employee')

    def setUp(self):
        super().setUp()
        with mock.patch.dict('os.environ', {DSN_ENV: DSN, ENVIRONMENT_ENV: 'test'}):
            self.assertTrue(init_error_reporting())
        self.addCleanup(self._stop_reporting)
        self.transport = CapturingTransport()
        sentry_sdk.get_client().transport = self.transport
        self.authenticate('sentry_emp', 'sentry_emp_pass_123')

    @staticmethod
    def _stop_reporting():
        sentry_sdk.get_client().close()
        sentry_sdk.get_global_scope().set_client(None)

    def _call(self, path, method='GET', body=None):
        return self.url_open(path, method=method, json=body, headers={'Content-Type': 'application/json'})

    def test_an_unexpected_failure_makes_one_event_without_private_values(self):
        self.opener.cookies.set(COOKIE, COOKIE_VALUE)
        with mock.patch(ME_SERIALIZER, side_effect=fail_with_private_values), self.assertLogs(API_LOGGER, 'ERROR'):
            response = self._call(f'/api/v1/me/profile?access_token={ACCESS_TOKEN}', 'PATCH', {'tz': BODY_VALUE})
        self.assertEqual(response.status_code, 500)
        events = self.transport.events
        self.assertEqual(len(events), 1)
        payload = '\n'.join(self.transport.payloads)
        for leak in LEAKS:
            self.assertNotIn(leak, payload)
        event = events[0]
        self.assertEqual(event['tags'], {'runtime': 'odoo', 'tenant_db': get_db_name()})
        self.assertEqual(event['environment'], 'test')
        self.assertEqual(event['request']['method'], 'PATCH')
        self.assertEqual(event['request']['url'], '/api/v1/me/profile')
        self.assertEqual(set(event['request']), {'method', 'url', 'headers'})
        self.assertEqual(list(event['user']), ['id'])
        for frame in event['exception']['values'][0]['stacktrace']['frames']:
            self.assertNotIn('vars', frame)

    def test_a_handled_refusal_makes_no_event(self):
        forbidden = self._call('/api/v1/admin/users')
        missing = self._call('/api/v1/me/company', 'POST', {'company_id': 999999999})
        invalid = self._call('/api/v1/me/profile', 'PATCH', {'tz': 'Nowhere/Land'})
        self.assertEqual((forbidden.status_code, missing.status_code, invalid.status_code), (403, 404, 422))
        self.assertEqual(self.transport.payloads, [])

    def test_an_error_log_record_outside_a_request_is_reported_scrubbed(self):
        with self.assertLogs('odoo.addons.liwan_platform.tests', 'ERROR'):
            logging.getLogger('odoo.addons.liwan_platform.tests').error('cron failed for %s', EMAIL)
        events = self.transport.events
        self.assertEqual(len(events), 1)
        self.assertNotIn(EMAIL, '\n'.join(self.transport.payloads))
        self.assertNotIn('request', events[0])
        self.assertEqual(events[0]['tags']['runtime'], 'odoo')

    def test_an_info_or_warning_record_makes_no_event(self):
        logger = logging.getLogger('odoo.addons.liwan_platform.tests')
        with self.assertLogs(logger, 'INFO'):
            logger.info('api constraint refused')
            logger.warning('slow request')
        self.assertEqual(self.transport.payloads, [])
