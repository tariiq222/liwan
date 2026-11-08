# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from time import time
from unittest.mock import patch

from odoo import fields
from odoo.tests import get_db_name, new_test_user, tagged

from .common import LiwanApiCase
from odoo.addons.liwan_api.models.res_users import LOGIN_CHALLENGE_TTL
from odoo.addons.liwan_core.models.login_code import CODE_ATTEMPTS, DAILY_SENDS
from odoo.addons.liwan_platform.models.entitlement_service import (
    OPERATOR_CONTEXT,
    LiwanTenantSuspended,
)


@tagged('post_install', '-at_install', 'liwan')
class TestLoginCodeRoutes(LiwanApiCase):
    """The second step of a sign-in: a password names the account, a code finishes the session."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.liwan_mobile = '+966590000011'
        cls.employee.email = 'api_emp@example.test'

    def setUp(self):
        super().setUp()
        # The delivery seam: an SMS provider does not exist yet, so the message is captured here.
        self.sent = []
        self.patch(
            type(self.env['liwan.sms.gateway']), '_liwan_send',
            lambda model, channel, destination, body: self.sent.append((channel, destination, body)),
        )
        self.env['liwan.login.code'].search([]).unlink()
        self.env['liwan.login.device'].search([]).unlink()

    def sent_code(self):
        return self.sent[-1][2].split()[-1]

    def authenticate(self, login='api_emp', password='api_emp_pass_123'):
        """The password step exactly as the Nuxt login route performs it."""
        return self.url_open(
            '/web/session/authenticate',
            json={
                'jsonrpc': '2.0', 'method': 'call', 'id': 0,
                'params': {'db': get_db_name(), 'login': login, 'password': password},
            },
            headers={'Content-Type': 'application/json'},
        )

    def _issue(self, channel='sms'):
        self.authenticate()
        return self.api('POST', '/api/v1/auth/code', {'channel': channel})

    # -- issuing -----------------------------------------------------------------------------

    def test_the_password_step_alone_never_grants_a_session(self):
        result = self.authenticate().json()['result']
        self.assertIsNone(result['uid'], 'the password step must leave the session pre-authenticated')
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

    def test_a_code_is_sent_and_the_answer_names_the_masked_destination(self):
        res = self._issue()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['channel'], 'sms')
        self.assertTrue(body['destination'].endswith('011'))
        self.assertNotIn('+966590000011', body['destination'])
        self.assertGreater(body['resend_after'], 0)
        self.assertNotIn('code', body, 'the plain code is never returned')

    def test_the_code_finishes_the_session(self):
        self._issue()
        code = self.sent_code()
        res = self.api('POST', '/api/v1/auth/verify', {'code': code})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['login'], 'api_emp')
        me = self.api('GET', '/api/v1/me')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()['login'], 'api_emp')

    def test_a_wrong_code_is_refused_without_a_session(self):
        self._issue()
        code = self.sent_code()
        wrong = '%06d' % ((int(code) + 1) % 1000000)
        res = self.api('POST', '/api/v1/auth/verify', {'code': wrong})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'invalid_code')
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

    def test_a_code_of_one_pending_session_does_not_finish_another(self):
        """The code is bound to the account the password step named, not to whichever session asks."""
        self._issue()
        code = self.sent_code()
        other = new_test_user(
            self.env, login='api_other', password='api_other_pass_123', name='Other',
            groups='liwan_core.group_employee',
        )
        other.email = 'api_other@example.test'
        self.authenticate(login='api_other', password='api_other_pass_123')
        res = self.api('POST', '/api/v1/auth/verify', {'code': code})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'invalid_code')
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

    def test_a_malformed_code_answers_422(self):
        self._issue()
        res = self.api('POST', '/api/v1/auth/verify', {'code': 'abc'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid_code_format')

    def test_verifying_without_a_pending_sign_in_is_refused(self):
        res = self.api('POST', '/api/v1/auth/verify', {'code': '123456'})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'no_pending_login')

    def test_issuing_without_a_pending_sign_in_is_refused(self):
        res = self.api('POST', '/api/v1/auth/code', {'channel': 'sms'})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'no_pending_login')

    def test_an_unknown_channel_is_refused(self):
        res = self._issue(channel='pigeon')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid_channel')

    def test_a_repeat_inside_the_cooldown_answers_429_with_the_wait(self):
        self._issue()
        res = self.api('POST', '/api/v1/auth/code', {'channel': 'sms'})
        self.assertEqual(res.status_code, 429)
        body = res.json()
        self.assertEqual(body['code'], 'resend_cooldown')
        self.assertGreater(body['details']['resend_after'], 0)

    def test_email_is_offered_when_no_mobile_is_saved(self):
        self.employee.liwan_mobile = False
        res = self._issue(channel='email')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['channel'], 'email')
        self.assertIn('@', res.json()['destination'])

    def test_the_code_channels_are_reported(self):
        self.authenticate()
        res = self.api('GET', '/api/v1/auth/channels')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['channels'], ['sms', 'email'])
        self.assertTrue(body['sms_available'])

    def test_the_channels_of_a_signed_in_caller_describe_that_account_only(self):
        """The route answers for the pending account, or for the signed-in caller; never for a stranger."""
        self.authenticate()
        body = self.api('GET', '/api/v1/auth/channels').json()
        self.assertTrue(body['has_mobile'])
        self.assertTrue(body['has_email'])
        # No session and nothing pending: there is no account to describe.
        self.opener.cookies.clear()
        res = self.api('GET', '/api/v1/auth/channels')
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'no_pending_login')

    def _assert_pending_rejected(self, code, status, reason):
        record = self.env['liwan.login.code'].search([('user_id', '=', self.employee.id)], limit=1)
        original_attempts = record.attempts
        self.opener.cookies.set('liwan_device', self.env['liwan.login.device']._liwan_issue(self.employee, 'pending')[1])
        for path, payload in (
            ('code', {'channel': 'email'}),
            ('verify', {'code': code, 'remember': True}),
            ('device', {}),
        ):
            with self.subTest(path=path):
                response = self.api('POST', f'/api/v1/auth/{path}', payload)
                self.assertEqual(response.status_code, status, response.text)
                self.assertEqual(response.json()['code'], reason)
        self.assertEqual(len(self.sent), 1)
        self.assertFalse(record.consumed_at)
        self.assertEqual(record.attempts, original_attempts)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

    def test_disabled_account_cannot_mutate_or_finalize_its_pending_sign_in(self):
        self.assertEqual(self._issue().status_code, 200)
        self.employee.active = False
        self._assert_pending_rejected(self.sent_code(), 403, 'login_refused')

    def test_reactivated_account_requires_a_new_password_step(self):
        self.assertEqual(self._issue().status_code, 200)
        access_version = self.employee.liwan_access_version
        self.employee.active = False
        self.employee.active = True
        self.assertGreater(self.employee.liwan_access_version, access_version)
        self._assert_pending_rejected(self.sent_code(), 401, 'no_pending_login')
        self.env['liwan.login.code'].search([('user_id', '=', self.employee.id)]).write({
            'cooldown_until': fields.Datetime.now() - timedelta(seconds=1),
        })
        self.assertEqual(self._issue(channel='email').status_code, 200)
        self.assertEqual(self.api('POST', '/api/v1/auth/verify', {'code': self.sent_code()}).status_code, 200)

    def test_password_reset_invalidates_pending_mutations_and_a_new_password_can_sign_in(self):
        self.assertEqual(self._issue().status_code, 200)
        self.employee.password = 'changed-password-456'
        self._assert_pending_rejected(self.sent_code(), 401, 'no_pending_login')
        self.env['liwan.login.code'].search([('user_id', '=', self.employee.id)]).write({
            'cooldown_until': fields.Datetime.now() - timedelta(seconds=1),
        })
        self.assertIsNone(self.authenticate(password='changed-password-456').json()['result']['uid'])
        self.assertEqual(self.api('POST', '/api/v1/auth/code', {'channel': 'email'}).status_code, 200)
        self.assertEqual(self.api('POST', '/api/v1/auth/verify', {'code': self.sent_code()}).status_code, 200)

    def test_expired_pending_sign_in_is_refused_before_any_mutation(self):
        self.assertEqual(self._issue().status_code, 200)
        with patch('odoo.addons.liwan_api.controllers.auth.time', return_value=time() + LOGIN_CHALLENGE_TTL):
            self._assert_pending_rejected(self.sent_code(), 401, 'no_pending_login')

    def test_signed_in_caller_can_inspect_channels_but_cannot_mutate_second_step(self):
        self.assertEqual(self._issue().status_code, 200)
        self.assertEqual(self.api('POST', '/api/v1/auth/verify', {'code': self.sent_code()}).status_code, 200)
        self.assertEqual(self.api('GET', '/api/v1/auth/channels').status_code, 200)
        for path, payload in (
            ('code', {'channel': 'email'}),
            ('verify', {'code': self.sent_code()}),
            ('device', {}),
        ):
            response = self.api('POST', f'/api/v1/auth/{path}', payload)
            self.assertEqual(response.status_code, 401, response.text)
            self.assertEqual(response.json()['code'], 'no_pending_login')
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)

    # -- remembered device -------------------------------------------------------------------

    def test_remember_this_device_sets_an_httponly_cookie_and_not_a_body_token(self):
        self._issue()
        res = self.api('POST', '/api/v1/auth/verify', {
            'code': self.sent_code(), 'remember': True, 'label': 'Chrome on macOS',
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()['remembered'])
        cookie = res.headers.get('Set-Cookie', '')
        self.assertIn('liwan_device=', cookie)
        self.assertIn('HttpOnly', cookie)
        self.assertNotIn('token', res.json())
        self.assertNotIn('token_hash', res.json())

    def test_a_remembered_device_finishes_a_later_sign_in_without_a_code(self):
        self._issue()
        res = self.api('POST', '/api/v1/auth/verify', {
            'code': self.sent_code(), 'remember': True, 'label': 'browser',
        })
        self.assertTrue(res.json()['remembered'])
        sent_before = len(self.sent)
        self.authenticate()
        followed = self.api('POST', '/api/v1/auth/device', {})
        self.assertEqual(followed.status_code, 200, followed.text)
        self.assertEqual(followed.json()['login'], 'api_emp')
        self.assertEqual(len(self.sent), sent_before, 'a remembered device needs no new code')

    def test_an_unremembered_browser_has_no_device_to_use(self):
        self.authenticate()
        res = self.api('POST', '/api/v1/auth/device', {})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'invalid_device')

    def test_a_revoked_device_is_refused(self):
        self._issue()
        self.api('POST', '/api/v1/auth/verify', {
            'code': self.sent_code(), 'remember': True, 'label': 'browser',
        })
        self.env['liwan.login.device'].search([('user_id', '=', self.employee.id)]).write({
            'revoked_at': fields.Datetime.now(),
        })
        self.authenticate()
        res = self.api('POST', '/api/v1/auth/device', {})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'invalid_device')

    def test_the_account_page_lists_and_forgets_devices(self):
        first, _raw = self.env['liwan.login.device']._liwan_issue(self.employee, 'old browser')
        second, _raw2 = self.env['liwan.login.device']._liwan_issue(self.employee, 'new browser')
        self._issue()
        self.assertEqual(
            self.api('POST', '/api/v1/auth/verify', {'code': self.sent_code()}).status_code, 200,
        )
        listed = self.api('GET', '/api/v1/me/devices')
        self.assertEqual(listed.status_code, 200, listed.text)
        body = listed.json()
        self.assertEqual([item['label'] for item in body['items']], ['new browser', 'old browser'])
        self.assertEqual(body['total'], 2)
        self.assertNotIn('token_hash', listed.text)
        self.assertNotIn('token', listed.text)

        # The Nuxt "forget all other devices" button calls DELETE /api/v1/me/devices. This browser signed in
        # with a code and holds no device cookie, so nothing is kept.
        forgotten = self.api('DELETE', '/api/v1/me/devices')
        self.assertEqual(forgotten.status_code, 200, forgotten.text)
        self.assertEqual(forgotten.json(), {'device_ids': []})
        self.assertTrue(first.revoked_at)
        self.assertTrue(second.revoked_at)
        self.assertEqual(self.api('GET', '/api/v1/me/devices').json()['items'], [])

    def test_forgetting_devices_keeps_the_browser_in_use(self):
        other, _raw = self.env['liwan.login.device']._liwan_issue(self.employee, 'old browser')
        self._issue()
        self.assertEqual(self.api('POST', '/api/v1/auth/verify', {
            'code': self.sent_code(), 'remember': True, 'label': 'this browser',
        }).status_code, 200)
        current = self.env['liwan.login.device'].search([('label', '=', 'this browser')])
        self.assertEqual(len(current), 1)
        forgotten = self.api('DELETE', '/api/v1/me/devices')
        self.assertEqual(forgotten.status_code, 200, forgotten.text)
        self.assertEqual(forgotten.json(), {'device_ids': [current.id]})
        self.assertTrue(other.revoked_at)
        self.assertFalse(current.revoked_at)

    def test_forgetting_devices_needs_a_signed_in_account(self):
        self.authenticate()
        res = self.api('DELETE', '/api/v1/me/devices')
        self.assertEqual(res.status_code, 401)
        self.assertEqual(self.env['liwan.login.device'].search_count([('revoked_at', '=', False)]), 0)

    # -- refusals keep their counters ------------------------------------------------------------

    def test_wrong_codes_in_separate_requests_burn_the_code(self):
        """Each refusal persists its attempt: the fifth wrong guess locks even the right code out."""
        self._issue()
        right = self.sent_code()
        wrong = '%06d' % ((int(right) + 1) % 1000000)
        for attempt in range(CODE_ATTEMPTS):
            res = self.api('POST', '/api/v1/auth/verify', {'code': wrong})
            self.assertEqual(res.status_code, 401, res.text)
            self.assertEqual(res.json()['code'], 'invalid_code')
            record = self.env['liwan.login.code'].search([('user_id', '=', self.employee.id)], limit=1)
            self.assertEqual(record.attempts, attempt + 1, 'the refusal must not roll the attempt back')
        self.assertTrue(record.revoked_at, 'the last allowed attempt burns the code')
        res = self.api('POST', '/api/v1/auth/verify', {'code': right})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'invalid_code')
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 401)

    def test_the_daily_cap_alert_survives_its_refusal(self):
        self.authenticate()
        model = type(self.env['liwan.login.code'])
        with patch.object(model, '_liwan_daily_sends', return_value=DAILY_SENDS):
            res = self.api('POST', '/api/v1/auth/code', {'channel': 'sms'})
        self.assertEqual(res.status_code, 503, res.text)
        self.assertEqual(res.json()['code'], 'daily_send_cap')
        self.assertEqual(self.env['liwan.login.code.alert'].search([]).attempts, 1)
        self.assertEqual(self.sent, [], 'no code goes out once the cap is reached')

    # -- tenant lifecycle --------------------------------------------------------------------

    def test_a_suspended_tenant_refuses_the_second_step(self):
        code_res = self._issue()
        self.assertEqual(code_res.status_code, 200)
        service = type(self.env['liwan.entitlement.service'])
        with patch.object(service, '_liwan_assert_login_allowed', side_effect=LiwanTenantSuspended()):
            res = self.api('POST', '/api/v1/auth/verify', {'code': self.sent_code()})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'tenant_suspended')

    def test_a_support_account_without_support_access_is_login_refused(self):
        self.env.cr.execute(
            'INSERT INTO res_groups_users_rel (gid, uid) VALUES (%s, %s)',
            [self.env.ref('liwan_core.group_vendor_support').id, self.employee.id],
        )
        self._issue()
        self.env['liwan.entitlement.service']._liwan_profile().with_context(**{OPERATOR_CONTEXT: True}).write(
            {'support_access_enabled': False},
        )
        res = self.api('POST', '/api/v1/auth/verify', {'code': self.sent_code()})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'login_refused')

    def test_a_suspended_tenant_names_the_suspension_only_after_the_password(self):
        service = type(self.env['liwan.entitlement.service'])
        with patch.object(service, '_liwan_assert_login_allowed', side_effect=LiwanTenantSuspended()):
            named = self.authenticate()
        self.assertTrue(named.json()['error']['data']['name'].endswith('LiwanTenantSuspended'), named.text)
        # A wrong password never reaches the lifecycle gate, so the name is not revealed for it.
        with patch.object(service, '_liwan_assert_login_allowed', side_effect=LiwanTenantSuspended()):
            unnamed = self.authenticate(password='not-the-password')
        self.assertFalse(unnamed.json()['error']['data']['name'].endswith('LiwanTenantSuspended'))
