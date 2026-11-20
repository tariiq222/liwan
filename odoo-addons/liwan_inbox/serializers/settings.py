# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of the inbox settings, lists and channels."""
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_inbox.serializers.channel_health import dump_health
from odoo.addons.liwan_inbox.serializers.conversation import dump_attachment, dump_ref


def dump_settings(settings):
    return {
        'visibility_policy': settings.visibility_policy,
        'auto_close_hours': settings.auto_close_hours,
        'retention_months': settings.retention_months,
        'assignment_policy': settings.assignment_policy,
        'first_response_alert_minutes': settings.first_response_alert_minutes,
        'report_retention_months': settings.report_retention_months,
        'agent_shifts_enabled': settings.agent_shifts_enabled,
        'unavailable_release': settings.unavailable_release,
    }


def dump_preset_preview(key, preview):
    """What a sector preset adds or sets, from `_liwan_preset_preview`: each named item says whether the company has it already."""
    preset, existing = preview['preset'], preview['existing']
    automation = preset['automation']
    buttons = {option['option_id']: option['title'] for _, _, option in automation['welcome']['option_ids']}
    return {
        'key': key,
        'applied': preview['applied'],
        'departments': [{'name': name, 'exists': name in existing['departments']} for name in preset['departments']],
        'tags': [{'name': name, 'exists': name in existing['tags']} for name in preset['tags']],
        'canned_replies': [
            {'shortcut': shortcut, 'body': body, 'exists': shortcut in existing['canned_replies']}
            for shortcut, body in preset['canned_replies']
        ],
        'welcome': {'body': automation['welcome']['body'], 'buttons': list(buttons.values())},
        'away': {'body': automation['away']['body']},
        'rules': [
            {
                'name': rule['name'], 'button': buttons[rule['option_id']], 'reply': rule['reply']['body'],
                'department': rule['department'], 'tags': rule['tags'], 'exists': rule['name'] in existing['rules'],
            }
            for rule in automation['rules']
        ],
        'campaigns': {name: preset['campaigns'][name] for name in ('stop_keywords', 'start_keywords', 'stop_reply', 'start_reply')},
        'settings': preset.get('settings'),
    }


def dump_department(department, members=True):
    """The department and, when the reader has a settings or agent right, its members."""
    return {
        'id': department.id, 'name': department.name,
        'members': [dump_ref(user) for user in department.member_ids] if members else [],
    }


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
    if kind == 'flow':
        return {'type': 'flow', 'text': text, 'flow': dump_ref(button.flow_id), 'provider_flow_id': button.provider_flow_id or ''}
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


def dump_channel_work(channel):
    """A channel the caller works on (its templates, forms or automation): id, name, kind and department only.

    Nothing an administrator sees (provider ids, secrets, health) belongs in this reference list.
    """
    return {
        'id': channel.id, 'name': channel.name, 'kind': channel.kind, 'department': dump_ref(channel.department_id),
    }


def dump_event(event):
    """One webhook delivery the operator may re-run: its state, attempts, last error and arrival time."""
    return {
        'id': event.id, 'state': event.state, 'attempts': event.attempts,
        'error': event.error or None, 'created_at': iso(event.create_date),
    }


def dump_connection(connection):
    """The account a channel serves, without any secret: the integrations page owns the account itself."""
    return {
        'id': connection.id, 'provider': connection.provider, 'external_id': connection.external_id,
        'label': connection.label or '', 'app_id': connection.app_id or None, 'state': connection.state,
        'status_message': connection.status_message or '',
    }


def dump_channel(channel):
    """The channel for its administrator.

    The provider account, its secrets and its webhook address belong to the connection and are managed on the
    integrations page; the channel reports the account it serves. A TikTok channel is its account, so it has no
    phone number id. `health` reads "unknown" until its provider health is read (Meta's number health for WhatsApp).
    """
    tiktok = channel.kind == 'tiktok'
    connection = channel.connection_id
    return {
        'id': channel.id,
        'name': channel.name,
        'kind': channel.kind,
        'state': channel.state,
        'department': dump_ref(channel.department_id),
        'connection': dump_connection(connection),
        'phone_number_id': None if tiktok else channel.phone_number_id or None,
        'last_error': channel.last_error or None,
        'last_event_at': iso(channel.last_event_at),
        'health': dump_health(channel),
        'needs_reconnect': tiktok and connection.state == 'error',
        'tiktok_welcome_audit': channel.tiktok_welcome_audit or None,
        'tiktok_questions_enabled': channel.tiktok_questions_enabled,
        'tiktok_prompts_enabled': channel.tiktok_prompts_enabled,
    }
