# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of the inbox settings, lists and channels."""
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.serializers.conversation import dump_ref


def dump_settings(settings):
    return {
        'visibility_policy': settings.visibility_policy,
        'auto_close_hours': settings.auto_close_hours,
        'retention_months': settings.retention_months,
    }


def dump_department(department):
    return {'id': department.id, 'name': department.name, 'members': [dump_ref(user) for user in department.member_ids]}


def dump_tag(tag):
    return dump_ref(tag)


def dump_canned_reply(reply):
    return {'id': reply.id, 'shortcut': reply.shortcut, 'body': reply.body}


def dump_template(template):
    return {
        'id': template.id, 'name': template.name, 'language': template.language,
        'category': template.category or '', 'status': template.status or '',
        'body': template.body or '', 'param_count': template.param_count,
    }


def dump_channel(channel, callback_url):
    """The channel for its administrator: secrets are reported only as present or absent."""
    return {
        'id': channel.id,
        'name': channel.name,
        'kind': channel.kind,
        'state': channel.state,
        'department': dump_ref(channel.department_id),
        'phone_number_id': channel.phone_number_id,
        'business_account_id': channel.business_account_id,
        'has_access_token': bool(channel.access_token_enc),
        'has_app_secret': bool(channel.app_secret_enc),
        'verify_token': channel.verify_token,
        'callback_url': callback_url,
        'last_error': channel.last_error or None,
        'last_event_at': iso(channel.last_event_at),
    }
