# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso


def dump_message_state(values):
    """Whitelist the plain state the messaging service returns for one row."""
    return {
        'id': values['id'],
        'channel': values['channel'],
        'origin': values['origin'],
        'state': values['state'],
        'to': values['to'],
        'sender_value': values['sender_value'],
        'segments': values['segments'],
        'error_code': values['error_code'],
        'error_message': values['error_message'],
        'has_receipt': values['has_receipt'],
        'created_at': iso(values['created_at']),
        'sent_at': iso(values['sent_at']),
        'read_at': iso(values['read_at']),
    }


def dump_message(message):
    """Whitelist one log row for a holder of ``integrations.log.read``; its connection and sender are named by id."""
    return {
        **dump_message_state(message._liwan_status_values()),
        'connection_id': message.connection_id.id or None,
        'sender_id': message.sender_id.id or None,
        'provider': message.provider,
        'account_ref': message.account_ref,
        'body': message.body or None,
        'content_sid': message.content_sid or None,
        'content_variables': message.content_variables or None,
        'requested_by': {'id': message.requested_by.id, 'name': message.requested_by.name} if message.requested_by else None,
        'provider_message_id': message.provider_message_id or None,
        'attempts': message.attempts,
    }


def dump_template(template):
    """Whitelist one content template of the provider account."""
    return {
        'sid': template['sid'],
        'name': template['name'],
        'language': template['language'],
        'types': list(template['types']),
        'variables': list(template['variables']),
    }
