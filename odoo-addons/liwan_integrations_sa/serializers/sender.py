# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso


def dump_sender(sender):
    """Whitelist one sender; its connection is named by id and provider, never with a credential."""
    return {
        'id': sender.id,
        'connection_id': sender.connection_id.id,
        'provider': sender.connection_id.provider,
        'channel': sender.channel,
        'kind': sender.kind,
        'value': sender.value,
        'is_default': sender.is_default,
        'active': sender.active,
        'created_at': iso(sender.create_date),
    }


def dump_available_number(number):
    """Whitelist one number of the provider account as the provider module lists it."""
    return {'value': number['value'], 'label': number['label'], 'sms': number['sms'], 'voice': number['voice']}


def dump_settings(values):
    """Whitelist the communication settings of the company (defaults included)."""
    return {'daily_message_limit': values['daily_message_limit']}
