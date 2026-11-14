# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from psycopg2 import IntegrityError

from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import ACCESS_TOKEN, ACCOUNT_ID, APP_SECRET, LiwanIntegrationsCase, grant
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_integrations_sa.providers import errors, meta


@tagged('post_install', '-at_install', 'liwan')
class TestIntegrationAccess(LiwanIntegrationsCase):
    """`_liwan_access` and the Python API an application calls."""

    def test_access_returns_the_identity_and_the_decrypted_secrets(self):
        connection = self.make_meta()
        access = connection._liwan_access('test.meta')
        self.assertEqual(
            {key: access[key] for key in ('external_id', 'app_id', 'access_token', 'app_secret')},
            {'external_id': ACCOUNT_ID, 'app_id': '1122334455', 'access_token': ACCESS_TOKEN, 'app_secret': APP_SECRET},
        )
        self.assertEqual(set(access), {'external_id', 'app_id', 'access_token', 'app_secret', 'verify_token'})

    def test_secrets_are_encrypted_at_rest_and_read_one_by_one(self):
        connection = self.make_meta()
        stored = connection.secret_ids.filtered(lambda row: row.name == 'access_token').value_enc
        self.assertNotIn(ACCESS_TOKEN, stored)
        self.assertEqual(secret_box.decrypt(self.env, 'liwan_integrations', stored), ACCESS_TOKEN)
        self.assertEqual(connection._liwan_secret('app_secret'), APP_SECRET)
        self.assertIsNone(connection._liwan_secret('nothing'))

    def test_an_unregistered_use_is_refused(self):
        with self.assertRaises(UserError):
            self.make_meta()._liwan_access('test.unknown')

    def test_a_use_of_another_provider_is_refused(self):
        with self.assertRaises(UserError):
            self.make_meta()._liwan_access('test.tiktok')

    def test_a_closed_feature_refuses_access(self):
        connection = self.make_meta()
        set_probe_feature(self, enabled=False)
        with self.assertRaises(AccessError):
            connection._liwan_access('test.meta')

    def test_a_disabled_connection_is_refused_and_not_offered_to_a_use(self):
        connection = self.make_meta(state='disabled')
        with self.assertRaises(UserError):
            connection._liwan_access('test.meta')
        self.assertFalse(self.env['liwan.integration.connection']._liwan_for_use('test.meta'))

    def test_a_missing_scope_is_refused(self):
        narrow = grant(scopes={'user.info.basic'})
        connection = self.make_tiktok(narrow)
        with self.assertRaisesRegex(UserError, 'message.list.read|connect the account again'):
            connection._liwan_access('test.tiktok')
        full = self.make_tiktok(grant(open_id='other-open-id'))
        self.assertEqual(full._liwan_access('test.tiktok')['external_id'], 'other-open-id')

    def test_for_use_lists_the_current_company_connections_of_the_provider(self):
        connection = self.make_meta()
        other_company = self.env['res.company'].create({'name': 'Integrations company F'})
        self.make_meta(external_id='999999999999', company=other_company)
        self.make_tiktok()
        self.assertEqual(self.env['liwan.integration.connection']._liwan_for_use('test.meta'), connection)
        with self.assertRaises(UserError):
            self.env['liwan.integration.connection']._liwan_for_use('test.unknown')

    def test_an_account_is_unique_per_company_and_provider(self):
        self.make_meta()
        with mute_logger('odoo.sql_db'), self.assertRaises(IntegrityError), self.env.cr.savepoint():
            self.make_meta()

    def test_only_a_provider_with_stored_connections_can_hold_one(self):
        Connection = self.env['liwan.integration.connection']
        for provider in ('nobody', 'zatca'):
            with self.assertRaises(ValidationError):
                Connection.create({'provider': provider, 'external_id': '1'})

    def test_test_connects_on_a_good_probe_and_records_an_error_on_a_bad_one(self):
        connection = self.make_meta(state='pending')
        with patch.object(meta, 'probe', return_value='Acme Business') as probe:
            connection._liwan_test()
        probe.assert_called_once_with(ACCOUNT_ID, ACCESS_TOKEN)
        self.assertEqual((connection.state, connection.label, connection.status_message), ('connected', 'Acme Business', False))
        self.assertTrue(connection.last_checked)
        with patch.object(meta, 'probe', side_effect=errors.ProviderError('Invalid token', retryable=False)):
            connection._liwan_test()
        self.assertEqual((connection.state, connection.status_message, connection.label), ('error', 'Invalid token', 'Acme Business'))

    def test_a_failing_test_keeps_a_disabled_connection_disabled(self):
        connection = self.make_meta(state='disabled')
        with patch.object(meta, 'probe', side_effect=errors.ProviderError('Invalid token', retryable=False)):
            connection._liwan_test()
        self.assertEqual(connection.state, 'disabled')

    def test_rotating_replaces_a_generated_secret_only(self):
        connection = self.make_meta()
        before = connection._liwan_secret('verify_token')
        value = connection._liwan_rotate_secret('verify_token')
        self.assertNotEqual(value, before)
        self.assertEqual(connection._liwan_secret('verify_token'), value)
        with self.assertRaises(ValidationError):
            connection._liwan_rotate_secret('access_token')

    def test_the_reader_sees_which_secrets_are_set_but_cannot_read_a_value(self):
        connection = self.make_meta()
        as_reader = connection.with_user(self.reader)
        self.assertEqual(as_reader.secret_names, ['access_token', 'app_secret', 'verify_token'])
        with self.assertRaises(AccessError):
            as_reader.secret_ids.mapped('value_enc')
