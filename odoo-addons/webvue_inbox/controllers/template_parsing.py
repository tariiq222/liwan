# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of a template write body (packages/contracts InboxTemplateWriteSchema): every limit is checked here again."""
import re
from dataclasses import dataclass

from odoo.http import request

from odoo.addons.webvue_api.controllers.common import parse_positive_int
from odoo.addons.webvue_inbox.adapters import media_rules
from odoo.addons.webvue_inbox.controllers.helpers import reject
from odoo.addons.webvue_inbox.controllers.reply_parsing import (
    parse_https_url,
    parse_list,
    parse_object,
    parse_string,
)
from odoo.addons.webvue_inbox.models.template import (
    MEDIA_HEADERS,
    OTP_BODY,
    PLACEHOLDER,
)

NAME = re.compile(r'^[a-z0-9_]{1,512}$')
LANGUAGE = re.compile(r'^[a-z]{2,3}(_[A-Z]{2})?$')
PHONE = re.compile(r'^\+[1-9]\d{6,14}$')
STANDARD_CATEGORIES = ('marketing', 'utility')
STANDARD_KEYS = {'name', 'language', 'category', 'allow_category_change', 'header', 'body', 'body_examples', 'footer', 'buttons'}
OTP_KEYS = {'name', 'language', 'category', 'add_security_recommendation', 'code_expiration_minutes', 'otp_button_text'}
MAX_BODY = 1024
MAX_EXAMPLES = 20
MAX_EXAMPLE = 1024
MAX_HEADER_TEXT = 60
MAX_FOOTER = 60
MAX_BUTTONS = 10
MAX_BUTTON_TEXT = 25
MAX_URL = 2000
MAX_COUPON = 15
MAX_URL_BUTTONS = 2
MAX_EXPIRATION_MINUTES = 90
URL_VARIABLE = '{{1}}'
NO_HEADER = {
    'header_type': 'none', 'header_text': False, 'header_example': False, 'header_example_attachment_id': False,
}
BUTTON_KEYS = {
    'quick_reply': ({'type', 'text'}, 'text'),
    'url': ({'type', 'text', 'url', 'example'}, 'text', 'url', 'example'),
    'phone_number': ({'type', 'text', 'phone_number'}, 'text', 'phone_number'),
    'copy_code': ({'type', 'example'}, 'example'),
}


@dataclass
class ParsedTemplate:
    """The validated template `values` and whether Meta may move the template to the category it judges right."""
    values: dict
    allow_category_change: bool = False


def placeholders(text):
    return [int(number) for number in PLACEHOLDER.findall(text)]


def check_placeholders(text, key, maximum=None):
    """Positions must run 1..n without gaps (and, with `maximum`, stop at it); returns how many there are."""
    used = set(placeholders(text))
    if any(number > len(used) for number in used) or (maximum is not None and len(used) > maximum):
        reject(f'{key} variables run {{{{1}}}}, {{{{2}}}}, ... without gaps' + (f' and at most {maximum}' if maximum else ''), key)
    return len(used)


def parse_flag(value, key):
    if not isinstance(value, bool):
        reject(f'{key} must be true or false', key)
    return value


def parse_example(value, key, maximum=MAX_EXAMPLE):
    return parse_string(value, key, maximum)


def parse_sample(channel, template, attachment_id, kind):
    """The sample file of a media header: an unused upload of the channel (or the template's own current sample)."""
    owners = [(channel._name, channel.id)] + ([(template._name, template.id)] if template else [])
    attachment = request.env['ir.attachment'].search([
        ('id', '=', parse_positive_int(attachment_id, 'example_attachment_id')),
    ]).filtered(lambda record: (record.res_model, record.res_id) in owners)
    if not attachment or media_rules.kind_of(attachment.mimetype) != kind:
        reject(f'example_attachment_id is not an uploaded {kind} sample of this channel', 'example_attachment_id')
    return attachment


def parse_header(channel, template, value):
    """The header fields of a write body: none, a text with at most one variable, a sample file or a location."""
    if value is None:
        return dict(NO_HEADER)
    kind = value.get('type') if isinstance(value, dict) else None
    if kind not in ('text', 'location', *MEDIA_HEADERS):
        reject('header.type must be text, image, video, document or location', 'header')
    if kind == 'text':
        value = parse_object(value, 'header', {'type', 'text', 'example'}, ('type', 'text', 'example'))
        text = parse_string(value['text'], 'header', MAX_HEADER_TEXT)
        variables = check_placeholders(text, 'header', maximum=1)
        if (variables == 1) != (value['example'] is not None):
            reject('a header variable needs exactly one example', 'header')
        example = parse_example(value['example'], 'header') if variables else False
        return {**NO_HEADER, 'header_type': 'text', 'header_text': text, 'header_example': example}
    if kind == 'location':
        parse_object(value, 'header', {'type'})
        return {**NO_HEADER, 'header_type': 'location'}
    value = parse_object(value, 'header', {'type', 'example_attachment_id'}, ('type', 'example_attachment_id'))
    if not channel.app_id:
        reject('the channel needs its Meta app id to upload the sample file of a media header', 'app_id')
    attachment = parse_sample(channel, template, value['example_attachment_id'], kind)
    return {**NO_HEADER, 'header_type': kind, 'header_example_attachment_id': attachment.id}


def parse_url_button(button):
    url = parse_https_url(button['url'], 'buttons', MAX_URL)
    base = url[:-len(URL_VARIABLE)] if url.endswith(URL_VARIABLE) else url
    if '{{' in base:
        reject('a button url holds one variable, {{1}}, at its end', 'buttons')
    variable = base != url
    if variable != (button['example'] is not None):
        reject('a button url variable needs an example', 'buttons')
    return {
        'url': url,
        'example': parse_https_url(button['example'], 'buttons', MAX_URL) if variable else False,
    }


def parse_button(button, position):
    kind = button.get('type') if isinstance(button, dict) else None
    if kind not in BUTTON_KEYS:
        reject('button type must be quick_reply, url, phone_number or copy_code', 'buttons')
    allowed, *required = BUTTON_KEYS[kind]
    button = parse_object(button, 'buttons', allowed, required)
    row = {'sequence': position, 'kind': kind}
    if 'text' in button:
        row['text'] = parse_string(button['text'], 'buttons', MAX_BUTTON_TEXT)
    if kind == 'url':
        row.update(parse_url_button(button))
    elif kind == 'phone_number':
        if not isinstance(button['phone_number'], str) or not PHONE.match(button['phone_number']):
            reject('phone_number must be an E.164 number such as +966500000000', 'buttons')
        row['phone_number'] = button['phone_number']
    elif kind == 'copy_code':
        row['example'] = parse_string(button['example'], 'buttons', MAX_COUPON)
    return row


def count_of(rows, kind):
    return sum(1 for row in rows if row['kind'] == kind)


def quick_replies_grouped(rows):
    """Quick replies sit together, before or after the other buttons, never interleaved."""
    runs = [row['kind'] == 'quick_reply' for row in rows]
    return sum(1 for index, quick in enumerate(runs) if index == 0 or quick != runs[index - 1]) <= 2


def parse_buttons(value):
    rows = [parse_button(button, position) for position, button in enumerate(parse_list(value, 'buttons', 0, MAX_BUTTONS))]
    if count_of(rows, 'url') > MAX_URL_BUTTONS or count_of(rows, 'phone_number') > 1 or count_of(rows, 'copy_code') > 1:
        reject('at most two url buttons, one phone button and one copy-code button', 'buttons')
    if not quick_replies_grouped(rows):
        reject('quick replies must be grouped together', 'buttons')
    return rows


def parse_identity(payload, template):
    """The name and language: free on create, unchangeable on edit."""
    name, language = payload['name'], payload['language']
    if not isinstance(name, str) or not NAME.match(name):
        reject('name must be lowercase letters, digits and underscores (1 to 512)', 'name')
    if not isinstance(language, str) or not LANGUAGE.match(language):
        reject('language must be a Meta language code such as ar or en_US', 'language')
    if template:
        for key, value in (('name', name), ('language', language)):
            if value != template[key]:
                reject(f'{key} cannot be changed once the template is created', key)
        return {}
    return {'name': name, 'language': language}


def parse_category(payload, template):
    category = payload['category']
    if category not in (*STANDARD_CATEGORIES, 'authentication'):
        reject('category must be marketing, utility or authentication', 'category')
    if template and category != template.category and (
            template.status == 'approved' or 'authentication' in (category, template.category)):
        reject('the category of an approved or authentication template cannot be changed', 'category')
    return category


def parse_standard(channel, payload, template):
    parse_object(payload, 'template', STANDARD_KEYS, STANDARD_KEYS)
    if payload['category'] not in STANDARD_CATEGORIES:
        reject('category must be marketing or utility', 'category')
    body = parse_string(payload['body'], 'body', MAX_BODY)
    variables = check_placeholders(body, 'body')
    examples = [parse_example(example, 'body_examples') for example in parse_list(payload['body_examples'], 'body_examples', 0, MAX_EXAMPLES)]
    if len(examples) != variables:
        reject('every body variable needs one example', 'body_examples')
    return {
        **parse_header(channel, template, payload['header']),
        'body': body,
        'example_ids': [(5, 0, 0), *((0, 0, {'position': position, 'example': example}) for position, example in enumerate(examples, start=1))],
        'footer': parse_string(payload['footer'], 'footer', MAX_FOOTER, nullable=True) or False,
        'button_ids': [(5, 0, 0), *((0, 0, row) for row in parse_buttons(payload['buttons']))],
        'add_security_recommendation': False,
        'code_expiration_minutes': 0,
    }


def parse_authentication(payload, template):
    parse_object(payload, 'template', OTP_KEYS, OTP_KEYS)
    minutes = payload['code_expiration_minutes']
    if minutes is not None and (isinstance(minutes, bool) or not isinstance(minutes, int) or not 1 <= minutes <= MAX_EXPIRATION_MINUTES):
        reject(f'code_expiration_minutes must be a whole number from 1 to {MAX_EXPIRATION_MINUTES}', 'code_expiration_minutes')
    button = {'sequence': 0, 'kind': 'otp', 'text': parse_string(payload['otp_button_text'], 'otp_button_text', MAX_BUTTON_TEXT)}
    return {
        **NO_HEADER,
        **({} if template else {'body': OTP_BODY}),
        'example_ids': [(5, 0, 0)],
        'footer': False,
        'button_ids': [(5, 0, 0), (0, 0, button)],
        'add_security_recommendation': parse_flag(payload['add_security_recommendation'], 'add_security_recommendation'),
        'code_expiration_minutes': minutes or 0,
    }


def parse_template_write(channel, payload, template=None):
    """The validated ParsedTemplate of a create (no `template`) or edit body; 422 naming the field on anything else."""
    if not isinstance(payload, dict) or not {'name', 'language', 'category'} <= set(payload):
        reject('name, language and category are required')
    values = {**parse_identity(payload, template), 'category': parse_category(payload, template)}
    if values['category'] == 'authentication':
        return ParsedTemplate({**values, **parse_authentication(payload, template)})
    parsed = ParsedTemplate({**values, **parse_standard(channel, payload, template)})
    parsed.allow_category_change = parse_flag(payload['allow_category_change'], 'allow_category_change')
    return parsed
