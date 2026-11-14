# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import hashlib
import hmac
import json
import os
import time
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import psycopg2

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST
from odoo.tools import mute_logger

from .common import (
    CLIENT_KEY,
    CLIENT_SECRET,
    OPEN_ID,
    PASSWORD,
    REDIRECT_URI,
    TIKTOK_ACCESS,
    TIKTOK_REFRESH,
    LiwanIntegrationsCase,
    grant,
)
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_integrations_sa.models.errors import ReconnectRequired
from odoo.addons.liwan_integrations_sa.providers import errors, tiktok

START = '/api/v1/integrations/oauth/tiktok/start'
CALLBACK = '/api/v1/integrations/oauth/tiktok/callback'
SETTINGS = '/settings/integrations'


@tagged('post_install', '-at_install', 'liwan')
class TestIntegrationOAuth(LiwanIntegrationsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {
            'LIWAN_TIKTOK_CLIENT_KEY': CLIENT_KEY,
            'LIWAN_TIKTOK_CLIENT_SECRET': CLIENT_SECRET,
            'LIWAN_TIKTOK_REDIRECT_URI': REDIRECT_URI,
        })
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)

    def setUp(self):
        super().setUp()
        self.login(self.admin)

    def state(self, **overrides):
        """A state signed the way the start route signs it, for the refusal cases."""
        values = {
            'c': self.env.company.id, 'u': self.admin.id, 'p': 'tiktok', 'us': ['test.tiktok'], 'h': HOST,
            'x': int(time.time()) + 600, **overrides,
        }
        payload = base64.urlsafe_b64encode(json.dumps(values, separators=(',', ':'), sort_keys=True).encode()).decode().rstrip('=')
        return f'{payload}.{hmac.new(CLIENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()}'

    def callback(self, state, code='auth-code-1'):
        return self.url_open(f'{CALLBACK}?code={code}&state={state}', method='GET', allow_redirects=False)

    def answer(self, authorization=None, label='liwan_shop'):
        """Exchange and probe answers of a successful callback, without any network call."""
        return (
            patch.object(tiktok, 'exchange_code', return_value=authorization or grant()),
            patch.object(tiktok, 'probe', return_value=label),
        )

    def connections(self):
        return self.env['liwan.integration.connection'].search([('provider', '=', 'tiktok')])

    def redirects_to(self, response, query):
        self.assertEqual(response.status_code, 302, response.text)
        self.assertEqual(response.headers['Location'], f'{SETTINGS}?provider=tiktok&{query}')

    def test_start_returns_a_signed_authorize_url(self):
        response = self.api('POST', START, {'uses': ['test.tiktok']})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(list(response.json()), ['authorize_url'])
        parsed = urlparse(response.json()['authorize_url'])
        self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ('https', 'www.tiktok.com', '/v2/auth/authorize'))
        query = parse_qs(parsed.query)
        self.assertEqual((query['client_key'], query['redirect_uri']), ([CLIENT_KEY], [REDIRECT_URI]))
        payload, _, signature = query['state'][0].partition('.')
        self.assertEqual(signature, hmac.new(CLIENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest())
        values = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        self.assertEqual(
            (values['c'], values['u'], values['p'], values['us'], values['h']),
            (self.env.company.id, self.admin.id, 'tiktok', ['test.tiktok'], HOST),
        )
        self.assertGreater(values['x'], int(time.time()))

    def test_start_validates_the_provider_and_the_uses(self):
        for path, body, status, code in (
            ('/api/v1/integrations/oauth/nobody/start', {'uses': ['test.tiktok']}, 404, 'not_found'),
            ('/api/v1/integrations/oauth/meta/start', {'uses': ['test.meta']}, 404, 'not_found'),
            (START, {}, 422, 'invalid'),
            (START, {'uses': []}, 422, 'invalid'),
            (START, {'uses': ['test.meta']}, 422, 'invalid'),
            (START, {'uses': ['test.unknown']}, 422, 'invalid'),
            (START, {'uses': ['test.tiktok'], 'extra': 1}, 422, 'invalid'),
            (START, {'uses': ['test.tiktok'], 'connection_id': 1}, 422, 'invalid'),
        ):
            with self.subTest(path=path, body=body):
                self.assertError(self.api('POST', path, body), status, code)

    def test_start_without_the_app_configuration_is_422_not_configured(self):
        with patch.dict(os.environ, {'LIWAN_TIKTOK_CLIENT_KEY': ''}):
            response = self.api('POST', START, {'uses': ['test.tiktok']})
        self.assertError(response, 422, 'integration_not_configured')
        self.assertEqual(response.json()['details']['reason'], 'integration_not_configured')

    def test_the_callback_connects_the_account_with_encrypted_tokens(self):
        exchange, probe = self.answer()
        with exchange, probe:
            response = self.callback(self.state())
        self.redirects_to(response, 'result=connected')
        connection = self.connections()
        self.assertEqual(len(connection), 1)
        self.assertEqual(
            (connection.external_id, connection.state, connection.label, connection.company_id),
            (OPEN_ID, 'connected', 'liwan_shop', self.env.company),
        )
        self.assertTrue(connection.token_expires_at and connection.refresh_expires_at)
        self.assertEqual(set(connection.scopes.split()), set(tiktok.SCOPES))
        self.assertEqual(connection._liwan_secret('access_token'), TIKTOK_ACCESS)
        self.assertEqual(connection._liwan_secret('refresh_token'), TIKTOK_REFRESH)
        self.assertFalse(any(TIKTOK_ACCESS in value for value in connection.secret_ids.mapped('value_enc')))
        self.assertNotIn(TIKTOK_ACCESS, response.text)
        self.assertNotIn(TIKTOK_REFRESH, response.text + response.headers['Location'])
        self.assertEqual(set(connection._liwan_access('test.tiktok')), {'external_id', 'app_id', 'access_token'})

    def test_connecting_the_same_account_again_updates_it_and_another_account_adds_a_second(self):
        exchange, probe = self.answer()
        with exchange, probe:
            self.callback(self.state())
            first = self.connections()
            self.callback(self.state())
            self.assertEqual(self.connections(), first)
        exchange, probe = self.answer(grant(open_id='second-open-id'), label='second_shop')
        with exchange, probe:
            self.redirects_to(self.callback(self.state()), 'result=connected')
        self.assertEqual(set(self.connections().mapped('external_id')), {OPEN_ID, 'second-open-id'})
        self.assertEqual(first.external_id, OPEN_ID)

    def test_a_tampered_expired_or_foreign_state_is_refused(self):
        good = self.state()
        tampered = good[:-1] + ('0' if good[-1] != '0' else '1')
        exchange, probe = self.answer()
        with exchange as exchanged, probe:
            for state in (tampered, self.state(x=int(time.time()) - 1), self.state(u=self.reader.id), self.state(p='meta'),
                          self.state(us='x'), 'not-a-state', ''):
                self.redirects_to(self.callback(state), 'error=invalid_state')
            self.assertFalse(self.connections())
            exchanged.assert_not_called()

    def test_a_state_minted_for_another_host_is_refused(self):
        exchange, probe = self.answer()
        with exchange, probe:
            for host in ('other-tenant.example', '', None, f'{HOST}.evil.example'):
                self.redirects_to(self.callback(self.state(h=host)), 'error=invalid_state')
            self.assertFalse(self.connections())

    def test_a_state_of_another_company_is_refused(self):
        other = self.env['res.company'].create({'name': 'Integrations company H'})
        exchange, probe = self.answer()
        with exchange, probe:
            self.redirects_to(self.callback(self.state(c=other.id)), 'error=invalid_state')
        self.assertFalse(self.connections())

    def test_a_non_ascii_state_is_refused_not_raised(self):
        self.redirects_to(self.callback('abc.%FF'), 'error=invalid_state')

    def test_an_account_connected_in_another_company_is_redirected_account_taken(self):
        other = self.env['res.company'].create({'name': 'Integrations company I'})
        self.make_tiktok(company=other)
        exchange, probe = self.answer()
        with exchange, probe:
            self.redirects_to(self.callback(self.state()), 'error=account_taken')
        self.assertEqual(self.connections().company_id, other)

    def test_the_same_company_reconnecting_its_own_account_still_works(self):
        mine = self.make_tiktok()
        exchange, probe = self.answer()
        with exchange, probe:
            self.redirects_to(self.callback(self.state()), 'result=connected')
        self.assertEqual(self.connections(), mine)

    def test_a_non_exclusive_provider_allows_the_same_account_in_two_companies(self):
        other = self.env['res.company'].create({'name': 'Integrations company J'})
        mine, theirs = self.make_meta(), self.make_meta(company=other)
        self.assertEqual(mine.external_id, theirs.external_id)
        self.assertEqual((mine.exclusive, theirs.exclusive), (False, False))
        # A limit the provider keeps per account is counted over every company's connection to it.
        self.assertEqual(set(mine._liwan_account_connection_ids()), set((mine | theirs).ids))

    def test_the_database_itself_refuses_a_second_company_on_an_exclusive_account(self):
        # Two companies finishing at the same moment both pass any check made in Python: the unique index is what holds,
        # and it refuses the second row at the insert itself.
        other = self.env['res.company'].create({'name': 'Integrations company K'})
        mine = self.make_tiktok()
        self.assertTrue(mine.exclusive)
        with mute_logger('odoo.sql_db'), self.assertRaises(psycopg2.errors.UniqueViolation) as refused, self.env.cr.savepoint():
            self.make_tiktok(company=other)
        self.assertIn('exclusive_account_unique', refused.exception.diag.constraint_name)

    def test_moving_a_connection_onto_an_account_another_company_holds_is_refused_too(self):
        other = self.env['res.company'].create({'name': 'Integrations company L'})
        mine = self.make_tiktok()
        theirs = self.make_tiktok(grant(open_id='business-open-id-other'), company=other)
        with mute_logger('odoo.sql_db'), self.assertRaises(psycopg2.errors.UniqueViolation), self.env.cr.savepoint():
            theirs.external_id = mine.external_id
            theirs.flush_recordset()

    def test_a_grant_missing_a_scope_a_use_needs_connects_nothing(self):
        exchange, probe = self.answer(grant(scopes={'user.info.basic'}))
        with exchange, probe:
            self.redirects_to(self.callback(self.state()), 'error=scopes_missing')
        self.assertFalse(self.connections())

    def test_a_refused_exchange_or_probe_connects_nothing(self):
        with patch.object(tiktok, 'exchange_code', side_effect=errors.ProviderError('bad code', retryable=False)):
            self.redirects_to(self.callback(self.state()), 'error=rejected')
        with patch.object(tiktok, 'exchange_code', return_value=grant()), \
                patch.object(tiktok, 'probe', side_effect=errors.ProviderError('no profile', retryable=False)):
            self.redirects_to(self.callback(self.state()), 'error=rejected')
        self.assertFalse(self.connections())

    def test_the_callback_without_the_app_configuration_redirects_not_configured(self):
        with patch.dict(os.environ, {'LIWAN_TIKTOK_CLIENT_KEY': ''}):
            self.redirects_to(self.callback(self.state()), 'error=not_configured')

    def test_a_denied_authorization_redirects_with_a_reason(self):
        response = self.url_open(f'{CALLBACK}?error=access_denied&state={self.state()}', method='GET', allow_redirects=False)
        self.redirects_to(response, 'error=denied')

    def test_the_callback_needs_the_manage_capability_and_the_feature(self):
        self.login(self.reader)
        self.assertError(self.callback(self.state(u=self.reader.id)), 403, 'forbidden')
        self.login(self.admin)
        set_probe_feature(self, key='integrations.enabled', enabled=False)
        self.assertEqual(self.callback(self.state()).status_code, 403)
        set_probe_feature(self, key='integrations.enabled', enabled=True)
        self.assertError(self.url_open('/api/v1/integrations/oauth/nobody/callback?code=x&state=y', method='GET'), 404, 'not_found')

    # token refresh

    def failing_refresh(self, retryable=False):
        return patch.object(tiktok, 'refresh_tokens', side_effect=errors.ProviderError('refused', retryable=retryable))

    def test_a_token_that_is_still_valid_is_not_refreshed(self):
        connection = self.make_tiktok()
        with patch.object(tiktok, 'refresh_tokens') as refresh:
            access = connection._liwan_access('test.tiktok')
        refresh.assert_not_called()
        self.assertEqual(access['access_token'], TIKTOK_ACCESS)

    def test_the_refresh_takes_a_blocking_row_lock_before_it_reads_the_tokens(self):
        connection = self.make_tiktok()
        with patch.object(type(connection), '_liwan_lock', autospec=True) as lock, patch.object(tiktok, 'refresh_tokens'):
            connection._liwan_access('test.tiktok')
        lock.assert_called_once_with(connection)
        connection._liwan_lock()

    def reading_application_user(self):
        """A user whose only access to connections and secrets is a read ACL row, as an application's own group gives."""
        group = self.env['res.groups'].create({'name': 'Test reading application'})
        for model in ('liwan.integration.connection', 'liwan.integration.secret'):
            self.env['ir.model.access'].create({
                'name': f'test read {model}', 'model_id': self.env['ir.model']._get_id(model),
                'group_id': group.id, 'perm_read': True,
            })
        user = new_test_user(
            self.env, login='integrations_app_user', password=PASSWORD, name='Reading application',
            groups='liwan_core.group_employee',
        )
        user.group_ids = [Command.link(group.id)]
        return user

    def test_an_application_user_with_read_access_only_refreshes_and_marks_a_dead_grant(self):
        user = self.reading_application_user()
        connection = self.make_tiktok(grant(expires_in=timedelta(minutes=1)))
        with self.assertRaises(AccessError):
            connection.with_user(user).write({'label': 'x'})
        fresh = tiktok.TokenGrant(
            OPEN_ID, frozenset(tiktok.SCOPES), 'fresh-access', 'fresh-refresh',
            fields.Datetime.now() + timedelta(days=1), fields.Datetime.now() + timedelta(days=300),
        )
        with patch.object(tiktok, 'refresh_tokens', return_value=fresh):
            access = connection.with_user(user)._liwan_access('test.tiktok')
        self.assertEqual(access['access_token'], 'fresh-access')
        self.assertEqual(connection._liwan_secret('refresh_token'), 'fresh-refresh')
        connection.write({
            'token_expires_at': fields.Datetime.now() - timedelta(hours=1),
            'refresh_expires_at': fields.Datetime.now() - timedelta(hours=1),
        })
        try:
            connection.with_user(user)._liwan_access('test.tiktok')
        except ReconnectRequired:
            pass
        else:
            self.fail('the reconnect was not demanded')
        self.assertEqual(connection.state, 'error')

    def test_a_token_near_its_deadline_is_refreshed_once_and_stored(self):
        connection = self.make_tiktok(grant(expires_in=timedelta(minutes=1)))
        fresh = tiktok.TokenGrant(
            OPEN_ID, frozenset(tiktok.SCOPES), 'fresh-access', 'fresh-refresh',
            fields.Datetime.now() + timedelta(days=1), fields.Datetime.now() + timedelta(days=300),
        )
        with patch.object(tiktok, 'refresh_tokens', return_value=fresh) as refresh:
            access = connection._liwan_access('test.tiktok')
            connection._liwan_access('test.tiktok')
        self.assertEqual(refresh.call_count, 1)
        refresh.assert_called_once_with(tiktok.app_config(os.environ), TIKTOK_REFRESH)
        self.assertEqual(access['access_token'], 'fresh-access')
        self.assertEqual(connection._liwan_secret('refresh_token'), 'fresh-refresh')
        self.assertEqual(connection.state, 'connected')

    def test_a_refresh_does_not_resume_a_disabled_connection(self):
        connection = self.make_tiktok(grant(expires_in=timedelta(minutes=1)))
        connection.state = 'disabled'
        with patch.object(tiktok, 'refresh_tokens', return_value=grant()) as refresh:
            connection._liwan_oauth_fresh()
        refresh.assert_called_once()
        self.assertEqual(connection.state, 'disabled')

    def test_an_expired_refresh_token_marks_the_connection_error_and_raises(self):
        connection = self.make_tiktok(grant(expires_in=timedelta(minutes=1), refresh_in=timedelta(seconds=-1)))
        with patch.object(tiktok, 'refresh_tokens') as refresh:
            try:
                connection._liwan_access('test.tiktok')
            except UserError as error:
                raised = error
            else:
                self.fail('the reconnect was not demanded')
        refresh.assert_not_called()
        self.assertIn('again', str(raised))
        self.assertEqual(connection.state, 'error')
        self.assertIn('again', connection.status_message)

    def test_a_refused_refresh_demands_a_reconnect_and_a_transient_failure_does_not(self):
        connection = self.make_tiktok(grant(expires_in=timedelta(minutes=1)))
        with self.failing_refresh(retryable=True), self.assertRaises(errors.ProviderError):
            connection._liwan_access('test.tiktok')
        self.assertEqual(connection.state, 'connected')
        with self.failing_refresh(retryable=False):
            try:
                connection._liwan_access('test.tiktok')
            except UserError:
                pass
            else:
                self.fail('the reconnect was not demanded')
        self.assertEqual(connection.state, 'error')

    def test_refreshing_without_the_app_configuration_is_422_not_configured(self):
        connection = self.make_tiktok(grant(expires_in=timedelta(minutes=1)))
        with patch.dict(os.environ, {'LIWAN_TIKTOK_CLIENT_SECRET': ''}), self.assertRaises(LiwanAccessRule) as caught:
            connection._liwan_access('test.tiktok')
        self.assertEqual((caught.exception.code, caught.exception.status), ('integration_not_configured', 422))

    def test_test_reads_the_profile_with_a_fresh_token_and_marks_a_dead_grant_error(self):
        connection = self.make_tiktok()
        with patch.object(tiktok, 'business_profile', return_value=tiktok.Profile('shop_name', 'Shop')) as profile:
            connection._liwan_test()
        profile.assert_called_once_with(tiktok.Credentials(OPEN_ID, TIKTOK_ACCESS))
        self.assertEqual((connection.state, connection.label), ('connected', 'shop_name'))
        connection.write({'token_expires_at': fields.Datetime.now() - timedelta(hours=1), 'refresh_expires_at': fields.Datetime.now() - timedelta(hours=1)})
        connection._liwan_test()
        self.assertEqual(connection.state, 'error')
