# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from datetime import datetime
from pathlib import Path

from odoo.exceptions import UserError
from odoo.tests import tagged
from odoo.tools import SQL

from .common import ACCESS_TOKEN, APP_SECRET, LiwanInboxCase
from odoo.addons.liwan_core.models import secret_box

MIGRATION = Path(__file__).parents[1] / 'migrations' / '19.0.1.23.0' / 'pre-move-accounts-to-connections.py'
PREVIOUS = '19.0.1.22.0'
OLD_PURPOSE = 'liwan_inbox'
NEW_PURPOSE = 'liwan_integrations'
OLD_COLUMNS = {
    'business_account_id': 'varchar', 'app_id': 'varchar', 'access_token_enc': 'varchar', 'app_secret_enc': 'varchar',
    'verify_token_enc': 'varchar', 'refresh_token_enc': 'varchar', 'tiktok_business_id': 'varchar',
    'tiktok_username': 'varchar', 'token_expires_at': 'timestamp', 'refresh_expires_at': 'timestamp',
}
ACCOUNT = '700000000001'
OTHER_ACCOUNT = '700000000002'
OPEN_ID = 'business-open-id-migration'
EXPIRES = datetime(2030, 1, 1, 12, 0)
REFRESH_EXPIRES = datetime(2031, 1, 1, 12, 0)


def load():
    spec = importlib.util.spec_from_file_location('pre_move_accounts_to_connections', MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@tagged('post_install', '-at_install', 'liwan')
class TestAccountConnectionMigration(LiwanInboxCase):
    """The pre- script moves each channel's account, tokens and secrets to one connection per account."""

    def old(self, value):
        return secret_box.encrypt(self.env, OLD_PURPOSE, value)

    def column_exists(self, column):
        self.env.cr.execute(
            """SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'liwan_inbox_channel' AND column_name = %s""",
            [column],
        )
        return bool(self.env.cr.fetchone())

    def old_layout(self, values):
        """The channel table as 19.0.1.22.0 left it: the old columns hold each channel's account, no connection is set.

        `values` is `{channel: {column: value}}`; every other channel keeps the account of its own connection.
        """
        self.env.flush_all()
        cr = self.env.cr
        for column, kind in OLD_COLUMNS.items():
            cr.execute(SQL('ALTER TABLE liwan_inbox_channel ADD COLUMN %s %s', SQL.identifier(column), SQL(kind)))
        cr.execute("""UPDATE liwan_inbox_channel channel SET business_account_id = connection.external_id
                        FROM liwan_integration_connection connection
                       WHERE connection.id = channel.connection_id AND channel.kind = 'whatsapp'""")
        cr.execute("""UPDATE liwan_inbox_channel channel SET tiktok_business_id = connection.external_id
                        FROM liwan_integration_connection connection
                       WHERE connection.id = channel.connection_id AND channel.kind = 'tiktok'""")
        for channel, columns in values.items():
            for column, value in columns.items():
                cr.execute(SQL('UPDATE liwan_inbox_channel SET %s = %s WHERE id = %s', SQL.identifier(column), value, channel.id))
        cr.execute('ALTER TABLE liwan_inbox_channel ALTER COLUMN connection_id DROP NOT NULL')
        cr.execute('UPDATE liwan_inbox_channel SET connection_id = NULL')
        cr.execute('DELETE FROM liwan_integration_secret')
        cr.execute('DELETE FROM liwan_integration_connection')
        self.env.invalidate_all()

    def whatsapp(self, phone_id, account, **old):
        channel = self.make_channel(phone_id=phone_id, business_account_id=account)
        return channel, {
            'access_token_enc': self.old(ACCESS_TOKEN), 'app_secret_enc': self.old(APP_SECRET), 'app_id': '123456789', **old,
        }

    def test_a_channel_per_account_becomes_one_connection_with_its_secrets_under_the_new_purpose(self):
        first, first_values = self.whatsapp('100000000051', ACCOUNT, verify_token_enc=self.old('first-verify-token'))
        second, second_values = self.whatsapp('100000000052', ACCOUNT, verify_token_enc=self.old('second-verify-token'))
        other, other_values = self.whatsapp('100000000053', OTHER_ACCOUNT, access_token_enc=self.old('other-access-token'))
        self.old_layout({first: first_values, second: second_values, other: other_values})
        load().migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        connection = first.connection_id
        self.assertEqual(second.connection_id, connection)
        self.assertNotEqual(other.connection_id, connection)
        self.assertEqual(
            (connection.provider, connection.external_id, connection.app_id, connection.company_id, connection.state),
            ('meta', ACCOUNT, '123456789', first.owner_company_id, 'connected'),
        )
        self.assertEqual(connection._liwan_secret('access_token'), ACCESS_TOKEN)
        self.assertEqual(connection._liwan_secret('app_secret'), APP_SECRET)
        self.assertEqual(connection._liwan_secret('verify_token'), 'first-verify-token')
        self.assertEqual(other.connection_id._liwan_secret('access_token'), 'other-access-token')
        self.env.cr.execute('SELECT value_enc FROM liwan_integration_secret WHERE connection_id = %s AND name = %s', [connection.id, 'access_token'])
        stored = self.env.cr.fetchone()[0]
        with self.assertRaises(UserError):
            secret_box.decrypt(self.env, OLD_PURPOSE, stored)
        for column in OLD_COLUMNS:
            self.assertFalse(self.column_exists(column), column)

    def test_the_channel_states_give_the_connection_state(self):
        connected, connected_values = self.whatsapp('100000000054', ACCOUNT)
        broken, broken_values = self.whatsapp('100000000055', OTHER_ACCOUNT)
        self.old_layout({connected: connected_values, broken: broken_values})
        self.env.cr.execute("UPDATE liwan_inbox_channel SET state = 'error', last_error = 'Invalid token' WHERE id = %s", [broken.id])
        load().migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertEqual(connected.connection_id.state, 'connected')
        self.assertEqual((broken.connection_id.state, broken.connection_id.status_message), ('error', 'Invalid token'))

    def test_a_tiktok_channel_keeps_its_tokens_username_and_deadlines(self):
        channel = self.make_tiktok_channel(OPEN_ID)
        self.old_layout({channel: {
            'access_token_enc': self.old('tt-access'), 'refresh_token_enc': self.old('tt-refresh'),
            'tiktok_username': 'liwan_shop', 'token_expires_at': EXPIRES, 'refresh_expires_at': REFRESH_EXPIRES,
        }})
        load().migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        connection = channel.connection_id
        self.assertEqual(
            (connection.provider, connection.external_id, connection.label, connection.state, connection.scopes),
            ('tiktok', OPEN_ID, 'liwan_shop', 'connected', 'message.list.read message.list.send user.info.basic'),
        )
        self.assertEqual((connection.token_expires_at, connection.refresh_expires_at), (EXPIRES, REFRESH_EXPIRES))
        self.assertEqual(connection._liwan_secret('access_token'), 'tt-access')
        self.assertEqual(connection._liwan_secret('refresh_token'), 'tt-refresh')

    def test_one_account_with_different_secrets_is_ambiguous_and_names_the_channels(self):
        first, first_values = self.whatsapp('100000000056', ACCOUNT)
        second, second_values = self.whatsapp('100000000057', ACCOUNT, access_token_enc=self.old('another-access-token'))
        self.old_layout({first: first_values, second: second_values})
        with self.assertRaises(UserError) as raised:
            load().migrate(self.env.cr, PREVIOUS)
        self.assertIn(str([first.id, second.id]), str(raised.exception))

    def test_a_fresh_install_and_a_second_run_change_nothing(self):
        channel, values = self.whatsapp('100000000058', ACCOUNT)
        self.old_layout({channel: values})
        load().migrate(self.env.cr, None)
        self.assertTrue(self.column_exists('access_token_enc'))
        load().migrate(self.env.cr, PREVIOUS)
        load().migrate(self.env.cr, PREVIOUS)
        self.env.invalidate_all()
        self.assertEqual(channel.connection_id.external_id, ACCOUNT)

    def test_only_a_database_still_holding_the_handshake_token_in_plain_text_is_refused(self):
        with self.assertRaisesRegex(UserError, 'plain'):
            load().migrate(self.env.cr, '19.0.1.12.0')
        # Every released version from the encrypted handshake token on is carried forward, the upgrade baseline too.
        load().migrate(self.env.cr, '19.0.1.17.0')
