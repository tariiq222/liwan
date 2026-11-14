# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import ACCOUNT_ID, APP_SECRET, LiwanIntegrationsCase

OTHER_ACCOUNT = '987654321098765'
THIRD_ACCOUNT = '555555555555555'


@tagged('post_install', '-at_install', 'liwan')
class TestIntegrationWebhookAccessors(LiwanIntegrationsCase):
    """A webhook has no session: the accessors answer plain data across companies, whoever the identity is."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.nobody = new_test_user(cls.env, login='integrations_nobody', name='No integrations ACL', groups='base.group_user')

    def setUp(self):
        super().setUp()
        self.branch = self.env['res.company'].create({'name': 'Webhook branch'})
        self.main = self.make_meta(ACCOUNT_ID)
        self.other = self.make_meta(OTHER_ACCOUNT, company=self.branch)
        self.tiktok = self.make_tiktok()

    def connection(self, user=None):
        return (self.env(user=user) if user else self.env)['liwan.integration.connection']

    def test_accounts_are_found_in_any_company_and_only_the_named_ones(self):
        for user in (None, self.nobody):
            with self.subTest(user=user and user.login):
                accounts = self.connection(user)._liwan_webhook_accounts('meta', [ACCOUNT_ID, OTHER_ACCOUNT, THIRD_ACCOUNT])
                self.assertEqual(
                    sorted(accounts, key=lambda row: row['id']),
                    [
                        {'id': self.main.id, 'company_id': self.main.company_id.id, 'external_id': ACCOUNT_ID},
                        {'id': self.other.id, 'company_id': self.branch.id, 'external_id': OTHER_ACCOUNT},
                    ],
                )
                self.assertTrue(all(type(row) is dict for row in accounts))
                self.assertEqual(self.connection(user)._liwan_webhook_accounts('meta', []), [])

    def test_the_nobody_user_has_no_acl_of_its_own(self):
        with self.assertRaises(AccessError):
            self.connection(self.nobody).search([])

    def test_a_disabled_connection_is_skipped_by_every_accessor(self):
        self.other.state = 'disabled'
        for user in (None, self.nobody):
            connection = self.connection(user)
            self.assertEqual([row['id'] for row in connection._liwan_webhook_accounts('meta', [ACCOUNT_ID, OTHER_ACCOUNT])], [self.main.id])
            self.assertIsNone(connection._liwan_webhook_secret(self.other.id, 'app_secret'))
            self.assertEqual(connection._liwan_webhook_secrets('meta', 'verify_token'), [self.main._liwan_secret('verify_token')])

    def test_a_secret_is_read_for_one_connection_in_any_company(self):
        for user in (None, self.nobody):
            connection = self.connection(user)
            self.assertEqual(connection._liwan_webhook_secret(self.main.id, 'app_secret'), APP_SECRET)
            self.assertEqual(connection._liwan_webhook_secret(self.other.id, 'verify_token'), self.other._liwan_secret('verify_token'))
            self.assertIsNone(connection._liwan_webhook_secret(999999999, 'app_secret'))

    def test_the_handshake_tokens_cover_every_company_of_the_provider(self):
        expected = sorted([self.main._liwan_secret('verify_token'), self.other._liwan_secret('verify_token')])
        for user in (None, self.nobody):
            self.assertEqual(sorted(self.connection(user)._liwan_webhook_secrets('meta', 'verify_token')), expected)

    def test_only_the_names_a_provider_declares_are_readable(self):
        connection = self.connection(self.nobody)
        for name in ('access_token', 'refresh_token', 'nothing'):
            with self.assertRaises(ValidationError):
                connection._liwan_webhook_secret(self.main.id, name)
            with self.assertRaises(ValidationError):
                connection._liwan_webhook_secrets('meta', name)
        with self.assertRaises(ValidationError):
            connection._liwan_webhook_secret(self.tiktok.id, 'access_token')
        with self.assertRaises(ValidationError):
            connection._liwan_webhook_secrets('tiktok', 'access_token')

    def test_an_unknown_or_external_provider_is_refused(self):
        connection = self.connection(self.nobody)
        for provider in ('nobody', 'zatca'):
            with self.assertRaises(ValidationError):
                connection._liwan_webhook_accounts(provider, [ACCOUNT_ID])
            with self.assertRaises(ValidationError):
                connection._liwan_webhook_secrets(provider, 'app_secret')
