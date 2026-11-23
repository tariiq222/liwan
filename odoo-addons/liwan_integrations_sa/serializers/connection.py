# Part of Odoo. See LICENSE file for full copyright and licensing details.
import os

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.models.constants import AUTH_EXTERNAL, AUTH_OAUTH


def _oauth_ready(provider):
    if provider['auth'] != AUTH_OAUTH:
        return None
    return providers.MODULES[provider['code']].app_config(os.environ) is not None


def dump_provider(provider, uses):
    """Whitelist one provider with the open uses that may hold a connection to it.

    ``oauth_ready`` tells whether the operator set the app keys an oauth provider needs (None for other providers).
    """
    return {
        'code': provider['code'],
        'auth': provider['auth'],
        'secrets': list(provider['secrets']),
        'generated_secrets': list(provider['generated_secrets']),
        'attributes': list(provider['attributes']),
        'uses': [{'key': use['key'], 'owner': use['owner']} for use in uses],
        'settings_path': provider['settings_path'],
        'oauth_ready': _oauth_ready(provider),
    }


def dump_connection(connection, public_base):
    """Whitelist a stored connection; a secret is shown as present or absent, never by value.

    ``public_base`` is called only when a webhook URL is built, so a tenant without a public base can still list.
    """
    registry = connection.env['liwan.integration.registry']
    provider = registry._liwan_provider_map()[connection.provider]
    present = set(connection.secret_names or ())
    hooked = [
        use for use in registry._liwan_open_uses() if use['provider'] == connection.provider and use.get('webhook_path')
    ]
    base = public_base() if hooked else ''
    webhooks = [{'use': use['key'], 'url': f'{base}{use["webhook_path"]}'} for use in hooked]
    return {
        'ref': f'connection:{connection.id}',
        'id': connection.id,
        'provider': connection.provider,
        'auth': provider['auth'],
        'external_id': connection.external_id,
        'label': connection.label or '',
        'app_id': connection.app_id or None,
        'state': connection.state,
        'status_message': connection.status_message or '',
        'last_checked': iso(connection.last_checked),
        'token_expires_at': iso(connection.token_expires_at),
        'secrets': [
            {'name': name, 'present': name in present}
            for name in (*provider['secrets'], *provider['generated_secrets'])
        ],
        'used_by': list(registry._liwan_connection_uses(connection)),
        'webhooks': webhooks,
        'settings_path': None,
    }


def dump_external(provider, status, uses):
    """Whitelist the derived status of an external provider (no row, no secret, no webhook); its open uses hold it."""
    return {
        'ref': f'external:{provider["code"]}',
        'id': None,
        'provider': provider['code'],
        'auth': AUTH_EXTERNAL,
        'external_id': None,
        'label': '',
        'app_id': None,
        'state': status['state'],
        'status_message': status['status_message'] or '',
        'last_checked': iso(status['last_checked']),
        'token_expires_at': None,
        'secrets': [],
        'used_by': [use['key'] for use in uses],
        'webhooks': [],
        'settings_path': provider['settings_path'],
    }
