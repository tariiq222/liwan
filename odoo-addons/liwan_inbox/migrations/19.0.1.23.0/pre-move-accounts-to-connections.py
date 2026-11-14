# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The provider account of a channel moves to a connection of the integrations service.

Every channel gets the `connection_id` of one connection per (company, provider, account id): the WhatsApp
business account id, or the TikTok business open id. The tokens and app secret are decrypted under the old
purpose and encrypted again under the service's, and the old columns are dropped. A group of channels that
cannot be told apart from one another (one account holding different secrets or app ids) is not guessed:
the script stops and names the channels.
"""
import secrets

from odoo import SUPERUSER_ID, api
from odoo.exceptions import UserError
from odoo.tools import SQL, parse_version

from odoo.addons.liwan_core.models import secret_box

OLD_PURPOSE = 'liwan_inbox'
NEW_PURPOSE = 'liwan_integrations'
OLD_COLUMNS = (
    'business_account_id', 'app_id', 'access_token_enc', 'app_secret_enc', 'verify_token_enc', 'refresh_token_enc',
    'tiktok_business_id', 'tiktok_username', 'token_expires_at', 'refresh_expires_at',
)
PROVIDERS = {'whatsapp': 'meta', 'tiktok': 'tiktok'}
# The scopes the TikTok connect of the old channel required before it stored a token.
TIKTOK_SCOPES = 'message.list.read message.list.send user.info.basic'
MESSAGE_LENGTH = 200
# The one schema this script reads: every column of OLD_COLUMNS exists there and the handshake token is encrypted.
REQUIRED_VERSION = '19.0.1.22.0'


def migrate(cr, version):
    if not version:
        return
    if parse_version(version) < parse_version(REQUIRED_VERSION):
        raise UserError(
            f'This database is at liwan_inbox {version}. Moving channel accounts to connections reads the '
            f'{REQUIRED_VERSION} schema only: upgrade the database with a LiwanOS checkout that ships '
            f'liwan_inbox {REQUIRED_VERSION} first, or recreate it.',
        )
    if not _has_column(cr, 'access_token_enc'):
        return
    cr.execute(SQL(
        'SELECT id, owner_company_id, kind, state, last_error, %s, verified_name FROM liwan_inbox_channel ORDER BY id',
        SQL(', ').join(SQL.identifier(column) for column in OLD_COLUMNS),
    ))
    channels = cr.dictfetchall()
    env = api.Environment(cr, SUPERUSER_ID, {})
    cr.execute('ALTER TABLE liwan_inbox_channel ADD COLUMN IF NOT EXISTS connection_id integer')
    for (company_id, provider, account_id), members in _groups(channels).items():
        connection_id = _connection(cr, env, company_id, provider, account_id, members)
        cr.execute('UPDATE liwan_inbox_channel SET connection_id = %s WHERE id = ANY(%s)', [connection_id, [m['id'] for m in members]])
    for column in OLD_COLUMNS:
        cr.execute(SQL('ALTER TABLE liwan_inbox_channel DROP COLUMN %s', SQL.identifier(column)))


def _has_column(cr, column):
    cr.execute(
        """SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'liwan_inbox_channel' AND column_name = %s""",
        [column],
    )
    return bool(cr.fetchone())


def _groups(channels):
    """``{(company id, provider, account id): [channel rows]}``; a channel without an account id stops the script."""
    groups = {}
    missing = []
    for channel in channels:
        provider = PROVIDERS[channel['kind']]
        account_id = channel['business_account_id'] if provider == 'meta' else channel['tiktok_business_id']
        if not account_id:
            missing.append(channel['id'])
            continue
        groups.setdefault((channel['owner_company_id'], provider, account_id), []).append(channel)
    if missing:
        raise UserError(f'Channels {missing} have no provider account id: set it or delete them, then upgrade again.')
    return groups


def _connection(cr, env, company_id, provider, account_id, members):
    """The id of the connection of one account, created with the secrets and state its channels held."""
    cr.execute(
        'SELECT id FROM liwan_integration_connection WHERE company_id = %s AND provider = %s AND external_id = %s',
        [company_id, provider, account_id],
    )
    existing = cr.fetchone()
    if existing:
        return existing[0]
    secrets_by_name = _secrets(env, provider, account_id, members)
    ids = [member['id'] for member in members]
    first = members[0]
    state, message = _state(members)
    cr.execute(
        """INSERT INTO liwan_integration_connection
                  (company_id, provider, external_id, label, app_id, state, status_message, scopes,
                   token_expires_at, refresh_expires_at, create_uid, write_uid, create_date, write_date)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now() at time zone 'utc', now() at time zone 'utc')
        RETURNING id""",
        [
            company_id, provider, account_id, first['tiktok_username'] if provider == 'tiktok' else first['verified_name'],
            _single(ids, [m['app_id'] for m in members], 'app id') if provider == 'meta' else None,
            state, message, TIKTOK_SCOPES if provider == 'tiktok' else None,
            first['token_expires_at'], first['refresh_expires_at'], SUPERUSER_ID, SUPERUSER_ID,
        ],
    )
    connection_id = cr.fetchone()[0]
    for name, value in secrets_by_name.items():
        cr.execute(
            """INSERT INTO liwan_integration_secret
                      (connection_id, company_id, name, value_enc, create_uid, write_uid, create_date, write_date)
               VALUES (%s, %s, %s, %s, %s, %s, now() at time zone 'utc', now() at time zone 'utc')""",
            [connection_id, company_id, name, secret_box.encrypt(env, NEW_PURPOSE, value), SUPERUSER_ID, SUPERUSER_ID],
        )
    return connection_id


def _secrets(env, provider, account_id, members):
    """``{name: plain value}`` of the account: the secrets all its channels agree on, and a handshake token."""
    ids = [member['id'] for member in members]
    if provider == 'tiktok':
        # One TikTok account is one channel, so there is nothing to compare.
        return _decrypted(env, members[0], {'access_token': 'access_token_enc', 'refresh_token': 'refresh_token_enc'})
    values = {
        'access_token': _single(ids, [_plain(env, m, 'access_token_enc') for m in members], f'access token of account {account_id}'),
        'app_secret': _single(ids, [_plain(env, m, 'app_secret_enc') for m in members], f'app secret of account {account_id}'),
    }
    # The handshake token only answers Meta's subscription check: the lowest channel's token stands for the account.
    tokens = [token for token in (_plain(env, m, 'verify_token_enc') for m in members) if token]
    values['verify_token'] = tokens[0] if tokens else secrets.token_urlsafe(24)
    return {name: value for name, value in values.items() if value}


def _decrypted(env, channel, columns):
    values = {name: _plain(env, channel, column) for name, column in columns.items()}
    return {name: value for name, value in values.items() if value}


def _plain(env, channel, column):
    """The plain value of one encrypted channel column, or None; an unreadable one stops the script."""
    if not channel[column]:
        return None
    try:
        return secret_box.decrypt(env, OLD_PURPOSE, channel[column])
    except UserError as error:
        raise UserError(f'Channel {channel["id"]}: {column} cannot be decrypted ({error}); fix the secret key, then upgrade again.') from None


def _single(channel_ids, values, what):
    """The one non-empty value the channels share; different values are ambiguous and stop the script."""
    present = {value for value in values if value}
    if len(present) > 1:
        raise UserError(
            f'Channels {channel_ids} share one WhatsApp account but hold different values of the {what}: '
            'make them agree (or delete the extra channels), then upgrade again.',
        )
    return next(iter(present), None)


def _state(channels):
    """The connection state and short message the channels' own states imply."""
    states = {channel['state'] for channel in channels}
    if 'connected' in states:
        return 'connected', None
    if 'error' in states:
        message = next((channel['last_error'] for channel in channels if channel['state'] == 'error' and channel['last_error']), None)
        return 'error', message[:MESSAGE_LENGTH] if message else None
    return ('disabled' if states == {'disabled'} else 'pending'), None
