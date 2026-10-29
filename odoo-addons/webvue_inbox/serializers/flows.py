# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of WhatsApp forms and their answers (packages/contracts/src/inbox/flows.ts)."""
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.serializers.refs import dump_ref

CHOICE_KINDS = ('dropdown', 'radio', 'checkbox')


def dump_option(option):
    return {'key': option.key, 'title': option.title, 'description': option.description or None}


def dump_field(field):
    """One component in the read shape of its kind: only the parts that kind has."""
    kind = field.kind
    head = {'id': field.id, 'kind': kind}
    if kind in ('heading', 'subheading', 'text', 'caption'):
        return {**head, 'text': field.text}
    shared = {'key': field.key, 'label': field.label, 'required': field.required}
    if kind == 'opt_in':
        return {**head, **shared}
    shared['sensitive'] = field.sensitive
    options = [dump_option(option) for option in field.option_ids.sorted('sequence')]
    if kind == 'text_input':
        return {
            **head, **shared, 'input_type': field.input_type, 'helper_text': field.helper_text or None,
            'min_chars': field.min_chars or None, 'max_chars': field.max_chars or None,
        }
    if kind == 'text_area':
        return {**head, **shared, 'helper_text': field.helper_text or None, 'max_length': field.max_length or None}
    if kind == 'date':
        return {
            **head, **shared, 'helper_text': field.helper_text or None,
            'min_date': field.min_date.isoformat() if field.min_date else None,
            'max_date': field.max_date.isoformat() if field.max_date else None,
        }
    if kind == 'checkbox':
        return {**head, **shared, 'min_selected': field.min_selected or None, 'max_selected': field.max_selected or None, 'options': options}
    return {**head, **shared, 'options': options}


def dump_screen(screen):
    return {
        'id': screen.id, 'key': screen.key, 'title': screen.title, 'footer_label': screen.footer_label,
        'fields': [dump_field(field) for field in screen.field_ids.sorted('sequence')],
    }


def dump_validation_error(error):
    return {'message': error.message, 'path': error.path or None, 'line': error.line or None, 'column': error.column or None}


def dump_flow_summary(flow):
    return {
        'id': flow.id,
        'channel': dump_ref(flow.channel_id),
        'name': flow.name,
        'category': flow.category,
        'language': flow.language,
        'status': flow.status,
        'health': flow.health,
        'provider_flow_id': flow.provider_flow_id or None,
        'json_version': flow.json_version or None,
        'supported': flow.supported,
        'editable': flow.editable,
        'sendable': flow.sendable,
        'error_count': len(flow.error_ids),
        'submission_count': flow.submission_count,
        'version_warning': flow.version_warning or None,
        'published_at': iso(flow.published_at),
        'updated_at': iso(flow.write_date),
    }


def dump_flow(flow):
    return {
        **dump_flow_summary(flow),
        'completion_message': flow.completion_message or None,
        'replaces': dump_ref(flow.replaces_id),
        'screens': [dump_screen(screen) for screen in flow.screen_ids.sorted('sequence')],
        'validation_errors': [dump_validation_error(error) for error in flow.error_ids],
    }


def dump_answer(answer):
    head = {'key': answer.key, 'label': answer.label, 'kind': answer.kind}
    if answer.kind in CHOICE_KINDS:
        return {**head, 'choices': [{'key': choice.key, 'title': choice.title} for choice in answer.choice_ids.sorted('sequence')]}
    return {**head, 'value': answer._webvue_value()}


def dump_submission(submission):
    return {
        'id': submission.id,
        'flow': dump_ref(submission.flow_id),
        'conversation_id': submission.conversation_id.id,
        'contact': dump_ref(submission.conversation_id.contact_id),
        'request_message_id': submission.request_message_id.id or None,
        'message_id': submission.message_id.id,
        'submitted_at': iso(submission.submitted_at),
        'answers': [dump_answer(answer) for answer in submission.answer_ids.sorted('sequence')],
    }


def dump_preview(preview):
    return {'url': preview['url'], 'expires_at': iso(preview['expires_at'])}
