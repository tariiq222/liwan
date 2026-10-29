# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of the inbox settings, lists and channels."""
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.serializers.channel_health import dump_health
from odoo.addons.webvue_inbox.serializers.conversation import dump_attachment, dump_ref


def dump_settings(settings):
    return {
        'visibility_policy': settings.visibility_policy,
        'auto_close_hours': settings.auto_close_hours,
        'retention_months': settings.retention_months,
        'assignment_policy': settings.assignment_policy,
        'first_response_alert_minutes': settings.first_response_alert_minutes,
    }


def dump_department(department):
    return {'id': department.id, 'name': department.name, 'members': [dump_ref(user) for user in department.member_ids]}


def dump_tag(tag):
    return dump_ref(tag)


def dump_canned_reply(reply):
    return {'id': reply.id, 'shortcut': reply.shortcut, 'body': reply.body}


def dump_template_header(template):
    kind = template.header_type
    if kind == 'none':
        return None
    if kind == 'text':
        return {'type': 'text', 'text': template.header_text or '', 'example': template.header_example or None}
    if kind == 'location':
        return {'type': 'location'}
    attachment = template.header_example_attachment_id
    return {'type': kind, 'example_attachment': dump_attachment(attachment) if attachment else None}


def dump_template_button(button):
    kind, text = button.kind, button.text or ''
    if kind == 'url':
        return {'type': 'url', 'text': text, 'url': button.url or '', 'example': button.example or None}
    if kind == 'phone_number':
        return {'type': 'phone_number', 'text': text, 'phone_number': button.phone_number or ''}
    if kind == 'copy_code':
        return {'type': 'copy_code', 'example': button.example or ''}
    return {'type': 'quick_reply', 'text': text}


def dump_template(template):
    buttons = template.button_ids.sorted('sequence')
    return {
        'id': template.id, 'name': template.name, 'language': template.language,
        'category': template.category, 'status': template.status, 'status_reason': template.status_reason or None,
        'quality': template.quality,
        'header': dump_template_header(template),
        'body': template.body or '',
        'body_examples': [example.example for example in template.example_ids.sorted('position')],
        'footer': template.footer or None,
        'buttons': [dump_template_button(button) for button in buttons.filtered(lambda button: button.kind != 'otp')],
        'add_security_recommendation': template.add_security_recommendation,
        'code_expiration_minutes': template.code_expiration_minutes or None,
        'otp_button_text': next((button.text for button in buttons if button.kind == 'otp'), None),
        'param_count': template.param_count,
        'editable': template.editable,
        'supported': template.supported,
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
        'app_id': channel.app_id or None,
        'verify_token': channel.verify_token,
        'callback_url': callback_url,
        'last_error': channel.last_error or None,
        'last_event_at': iso(channel.last_event_at),
        'health': dump_health(channel),
    }
