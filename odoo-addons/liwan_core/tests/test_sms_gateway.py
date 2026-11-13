# Part of Odoo. See LICENSE file for full copyright and licensing details.
import os
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models import sms_gateway
from odoo.addons.liwan_core.models.login_code import HOURLY_SENDS
from odoo.addons.liwan_core.models.sms_gateway import (
    AUTHENTICA,
    AUTHENTICA_ENDPOINT,
    AUTHENTICA_KEY_ENV,
    AUTHENTICA_TEMPLATE_ENV,
    PROVIDER_PARAM,
    SIMULATOR,
)

KEY = 'fixture-authentica-key-9f3a'
TEMPLATE = '42'
MOBILE = '+966590000001'
LOGGER = 'odoo.addons.liwan_core.models.sms_gateway'


def response(status=200, body=None):
    reply = MagicMock()
    reply.ok = 200 <= status < 300
    reply.status_code = status
    reply.json.return_value = {'success': True} if body is None else body
    return reply


@tagged('post_install', '-at_install')
class SmsGatewayCase(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(
            cls.env, login='sms_user', password='twelve-chars-ok', name='Sms User',
            groups='liwan_core.group_employee',
        )
        cls.user.liwan_mobile = MOBILE
        cls.gateway = cls.env['liwan.sms.gateway']
        cls.codes = cls.env['liwan.login.code']

    def configure(self, *, key=KEY, template=TEMPLATE, provider=AUTHENTICA):
        env = {AUTHENTICA_KEY_ENV: key, AUTHENTICA_TEMPLATE_ENV: template}
        patcher = patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        if provider:
            self.env['ir.config_parameter'].set_param(PROVIDER_PARAM, provider)

    def unconfigure(self):
        patcher = patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop(AUTHENTICA_KEY_ENV, None)
        os.environ.pop(AUTHENTICA_TEMPLATE_ENV, None)

    def clear_cooldown(self):
        self.codes.search([('user_id', '=', self.user.id)]).write({'cooldown_until': '2000-01-01 00:00:00'})

    # -- the happy path -------------------------------------------------------------------------

    def test_the_generated_code_is_sent_once_with_the_template(self):
        self.configure()
        with patch.object(sms_gateway.requests, 'post', return_value=response()) as post:
            outcome = self.codes._liwan_issue(self.user, 'sms')
        self.assertEqual(outcome.error, '')
        post.assert_called_once()
        self.assertEqual(post.call_args.args, (AUTHENTICA_ENDPOINT,))
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs['headers']['X-Authorization'], KEY)
        self.assertEqual(kwargs['json']['method'], 'sms')
        self.assertEqual(kwargs['json']['phone'], MOBILE)
        self.assertEqual(kwargs['json']['template_id'], 42)
        self.assertEqual(set(kwargs['json']), {'method', 'phone', 'otp', 'template_id'})
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(kwargs['timeout'], sms_gateway.AUTHENTICA_TIMEOUT)
        # The code Authentica delivers is the one Odoo verifies.
        self.assertIsNone(self.codes._liwan_verify(self.user, kwargs['json']['otp']))

    def test_the_provider_is_authentica_without_a_parameter_when_credentials_exist(self):
        self.configure(provider=None)
        self.env['ir.config_parameter'].set_param(PROVIDER_PARAM, False)
        self.assertEqual(self.gateway._liwan_provider(), AUTHENTICA)
        self.assertTrue(self.gateway._liwan_sms_available())

    def test_success_logs_nothing(self):
        self.configure()
        with patch.object(sms_gateway.requests, 'post', return_value=response()), self.assertNoLogs(LOGGER):
            self.codes._liwan_issue(self.user, 'sms')

    # -- missing configuration ------------------------------------------------------------------

    def test_without_credentials_sms_is_not_offered_and_nothing_is_sent(self):
        self.unconfigure()
        self.env['ir.config_parameter'].set_param(PROVIDER_PARAM, AUTHENTICA)
        self.assertFalse(self.gateway._liwan_sms_available())
        with patch.object(sms_gateway.requests, 'post') as post:
            outcome = self.codes._liwan_issue(self.user, 'sms')
        self.assertEqual(outcome.error, 'channel_unavailable')
        post.assert_not_called()
        self.assertFalse(self.codes.search([('user_id', '=', self.user.id)]))
        # Email is unaffected.
        self.assertEqual(self.codes._liwan_issue(self.user, 'email').error, '')

    def test_a_malformed_template_id_is_not_configured(self):
        for template in ('', 'abc', '4 2', '٤٢'):
            with self.subTest(template=template):
                self.configure(template=template)
                self.assertFalse(self.gateway._liwan_sms_available())

    def test_an_unknown_provider_is_unavailable(self):
        self.configure(provider='pigeon')
        self.assertFalse(self.gateway._liwan_sms_available())

    def test_the_simulator_is_refused_in_production(self):
        self.unconfigure()
        self.env['ir.config_parameter'].set_param(PROVIDER_PARAM, SIMULATOR)
        self.assertTrue(self.gateway._liwan_sms_available())
        self.patch(type(self.gateway), '_liwan_is_production', lambda model: True)
        self.assertFalse(self.gateway._liwan_sms_available())

    # -- provider failure -----------------------------------------------------------------------

    def test_a_provider_failure_is_one_attempt_and_leaves_email_open(self):
        failures = {
            'http error': response(status=500),
            'redirect': response(status=307),
            'rejection': response(body={'success': False}),
            'missing flag': response(body={}),
            'not an object': response(body=[]),
            'timeout': requests.Timeout('slow'),
            'connection': requests.ConnectionError('down'),
            'bad json': ValueError('not json'),
        }
        for label, outcome_of_post in failures.items():
            with self.subTest(label):
                self.codes.search([('user_id', '=', self.user.id)]).unlink()
                self.configure()
                kwargs = {'side_effect': outcome_of_post} if isinstance(outcome_of_post, Exception) else {
                    'return_value': outcome_of_post,
                }
                with patch.object(sms_gateway.requests, 'post', **kwargs) as post, self.assertLogs(LOGGER, 'WARNING'):
                    outcome = self.codes._liwan_issue(self.user, 'sms')
                self.assertEqual(outcome.error, 'channel_unavailable')
                self.assertEqual(post.call_count, 1, 'a failure must not send a second SMS')
                # The failed row counts toward the caps but holds no cooldown or usable code.
                self.assertEqual(self.codes.search_count([('user_id', '=', self.user.id)]), 1)
                self.assertTrue(outcome.record.revoked_at)
                self.assertEqual(self.codes._liwan_resend_after(self.user), 0)
                self.assertEqual(self.codes._liwan_issue(self.user, 'email').error, '')

    def test_the_credentials_phone_and_code_never_reach_the_logs(self):
        self.configure()
        secret_error = requests.ConnectionError(f'{KEY} {MOBILE} 123456')
        with patch.object(sms_gateway.requests, 'post', side_effect=secret_error), self.assertLogs(
            LOGGER, 'WARNING',
        ) as logs:
            self.codes._liwan_issue(self.user, 'sms')
        text = '\n'.join(logs.output)
        self.assertNotIn(KEY, text)
        self.assertNotIn(MOBILE, text)
        self.assertNotIn('123456', text)
        with patch.object(sms_gateway.requests, 'post', return_value=response(status=401)), self.assertLogs(
            LOGGER, 'WARNING',
        ) as logs:
            self.clear_cooldown()
            self.codes._liwan_issue(self.user, 'sms')
        self.assertNotIn(KEY, '\n'.join(logs.output))
        self.assertNotIn(MOBILE, '\n'.join(logs.output))

    def test_a_failing_provider_cannot_be_hammered_past_the_caps(self):
        self.configure()
        with patch.object(sms_gateway.requests, 'post', side_effect=requests.Timeout), self.assertLogs(
            LOGGER, 'WARNING',
        ):
            errors = []
            for _ in range(HOURLY_SENDS + 1):
                errors.append(self.codes._liwan_issue(self.user, 'sms').error)
        self.assertEqual(errors[-1], 'send_limit_reached')
