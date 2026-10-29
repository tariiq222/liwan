# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of the reply body (packages/contracts InboxReplyCreateSchema): every limit is checked here again."""
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from odoo.http import request

from odoo.addons.webvue_api.controllers.common import parse_positive_int
from odoo.addons.webvue_inbox.adapters import media_rules
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    find_one,
    reject,
)

MAX_BODY = 4096
MAX_CAPTION = 1024
MAX_TEMPLATE_PARAMS = 20
MAX_PARAM = 1024
MAX_HEADER_PARAM = 60
MAX_BUTTON_PARAMS = 3
MAX_BUTTON_PARAM = 2000
MAX_TEMPLATE_BUTTONS = 10
TEMPLATE_REPLY_KEYS = {
    'template_id', 'params', 'header_param', 'header_attachment_id', 'header_location', 'button_params',
}
MAX_LOCATION_TEXT = 1000
MAX_INTERACTIVE_BODY = 1024
MAX_INTERACTIVE_AFFIX = 60
MAX_OPTION_ID = 200
MAX_BUTTONS = 3
MAX_BUTTON_TITLE = 20
MAX_LIST_ROWS = 10
MAX_SECTIONS = 10
MAX_SECTION_TITLE = 24
MAX_ROW_TITLE = 24
MAX_ROW_DESCRIPTION = 72
MAX_CTA_URL = 2000
CONTENT_KEYS = ('body', 'attachment_id', 'location', 'interactive', 'template_id')
INTERACTIVE_TYPES = ('buttons', 'list', 'cta_url')
SHARED_INTERACTIVE_KEYS = {'type', 'body', 'header', 'footer'}


@dataclass
class ParsedReply:
    """A validated reply: message `values`, or a `template` with `params`, plus the optional file and reply target."""
    values: dict = field(default_factory=dict)
    template: object = None
    params: tuple = ()
    header: dict = field(default_factory=dict)
    button_params: tuple = ()
    attachment: object = None
    reply_to: object = None


def parse_string(value, key, maximum, minimum=1, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        reject(f'{key} must be a string of {minimum} to {maximum} characters', key)
    return value.strip()


def parse_object(value, key, allowed, required=()):
    if not isinstance(value, dict):
        reject(f'{key} must be an object', key)
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        reject(f'field {unknown[0]!r} is not accepted in {key}', key)
    missing = [name for name in required if name not in value]
    if missing:
        reject(f'field {missing[0]!r} is required in {key}', key)
    return value


def parse_list(value, key, minimum, maximum):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        reject(f'{key} must be a list of {minimum} to {maximum} items', key)
    return value


def parse_coordinate(value, key, limit):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not -limit <= value <= limit:
        reject(f'{key} must be a number between {-limit} and {limit}', key)
    return float(value)


def parse_location(value):
    value = parse_object(value, 'location', {'latitude', 'longitude', 'name', 'address'}, ('latitude', 'longitude'))
    name = parse_string(value.get('name'), 'location', MAX_LOCATION_TEXT, nullable=True)
    address = parse_string(value.get('address'), 'location', MAX_LOCATION_TEXT, nullable=True)
    latitude, longitude = parse_coordinate(value['latitude'], 'latitude', 90), parse_coordinate(value['longitude'], 'longitude', 180)
    return {
        'kind': 'location', 'latitude': latitude, 'longitude': longitude,
        'location_name': name or False, 'location_address': address or False,
        'body': name or address or f'{latitude:.6f}, {longitude:.6f}',
    }


def parse_option_id(value, key, seen):
    option_id = parse_string(value, key, MAX_OPTION_ID)
    if option_id in seen:
        reject(f'{key} ids must be unique', key)
    seen.add(option_id)
    return option_id


def option(sequence, option_id, title, section_title=False, description=False):
    return {
        'sequence': sequence, 'option_id': option_id, 'title': title,
        'section_title': section_title, 'description': description,
    }


def parse_buttons(value):
    value = parse_object(value, 'interactive', SHARED_INTERACTIVE_KEYS | {'buttons'}, ('buttons',))
    seen = set()
    options = []
    for index, button in enumerate(parse_list(value['buttons'], 'buttons', 1, MAX_BUTTONS)):
        button = parse_object(button, 'buttons', {'id', 'title'}, ('id', 'title'))
        options.append(option(
            index, parse_option_id(button['id'], 'buttons', seen), parse_string(button['title'], 'buttons', MAX_BUTTON_TITLE),
        ))
    return {'options': options}


def parse_list_rows(value):
    value = parse_object(value, 'interactive', SHARED_INTERACTIVE_KEYS | {'button', 'sections'}, ('button', 'sections'))
    sections = parse_list(value['sections'], 'sections', 1, MAX_SECTIONS)
    seen, options = set(), []
    for section in sections:
        section = parse_object(section, 'sections', {'title', 'rows'}, ('rows',))
        title = parse_string(section.get('title'), 'sections', MAX_SECTION_TITLE, nullable=True)
        if title is None and len(sections) > 1:
            reject('sections need a title when there is more than one', 'sections')
        for row in parse_list(section['rows'], 'rows', 1, MAX_LIST_ROWS):
            row = parse_object(row, 'rows', {'id', 'title', 'description'}, ('id', 'title'))
            options.append(option(
                len(options), parse_option_id(row['id'], 'rows', seen), parse_string(row['title'], 'rows', MAX_ROW_TITLE),
                title or False, parse_string(row.get('description'), 'rows', MAX_ROW_DESCRIPTION, nullable=True) or False,
            ))
    if len(options) > MAX_LIST_ROWS:
        reject(f'a list holds at most {MAX_LIST_ROWS} rows', 'sections')
    return {'options': options, 'interactive_button': parse_string(value['button'], 'button', MAX_BUTTON_TITLE)}


def parse_https_url(value, key, maximum):
    """An https address of at most `maximum` characters without whitespace."""
    url = parse_string(value, key, maximum)
    try:
        parts = urlsplit(url)
        valid = parts.scheme == 'https' and parts.hostname and not any(char.isspace() for char in url)
    except ValueError:
        valid = False
    if not valid:
        reject(f'{key} must be an https address', key)
    return url


def parse_cta_url(value):
    value = parse_object(value, 'interactive', SHARED_INTERACTIVE_KEYS | {'display_text', 'url'}, ('display_text', 'url'))
    return {
        'cta_display_text': parse_string(value['display_text'], 'display_text', MAX_BUTTON_TITLE),
        'cta_url': parse_https_url(value['url'], 'url', MAX_CTA_URL),
    }


PARSE_INTERACTIVE = {'buttons': parse_buttons, 'list': parse_list_rows, 'cta_url': parse_cta_url}


def parse_interactive(value):
    if not isinstance(value, dict) or value.get('type') not in INTERACTIVE_TYPES:
        reject(f'interactive.type must be one of {INTERACTIVE_TYPES}', 'interactive')
    specific = PARSE_INTERACTIVE[value['type']](value)
    options = specific.pop('options', [])
    return {
        'kind': 'interactive', 'interactive_type': value['type'],
        'body': parse_string(value.get('body'), 'body', MAX_INTERACTIVE_BODY),
        'interactive_header': parse_string(value.get('header'), 'header', MAX_INTERACTIVE_AFFIX, nullable=True) or False,
        'interactive_footer': parse_string(value.get('footer'), 'footer', MAX_INTERACTIVE_AFFIX, nullable=True) or False,
        'option_ids': [(0, 0, row) for row in options],
        **specific,
    }


def find_upload(conversation, attachment_id):
    """An upload of THIS conversation that no reply has used yet; anything else is a 422."""
    attachment = request.env['ir.attachment'].search([
        ('id', '=', parse_positive_int(attachment_id, 'attachment_id')),
        ('res_model', '=', conversation._name), ('res_id', '=', conversation.id),
    ])
    if not attachment:
        reject('attachment_id is not an unused upload of this conversation', 'attachment_id')
    return attachment


def parse_attachment(conversation, payload):
    attachment = find_upload(conversation, payload['attachment_id'])
    kind = media_rules.kind_of(attachment.mimetype)
    if not kind:
        reject('attachment_id is not a file WhatsApp accepts', 'attachment_id')
    caption = parse_string(payload['caption'], 'caption', MAX_CAPTION) if 'caption' in payload else None
    if caption and kind not in media_rules.CAPTION_KINDS:
        reject(f'a {kind} cannot have a caption', 'caption')
    return ParsedReply(values={'body': caption or f'[{kind}]'}, attachment=attachment)


def parse_header_input(conversation, payload):
    """The header values of a template reply: `text`, `attachment` (an upload of the conversation) and `location`."""
    header = {}
    if 'header_param' in payload:
        header['text'] = parse_string(payload['header_param'], 'header_param', MAX_HEADER_PARAM)
    if 'header_attachment_id' in payload:
        header['attachment'] = find_upload(conversation, payload['header_attachment_id'])
    if 'header_location' in payload:
        location = parse_location(payload['header_location'])
        header['location'] = {
            key: location[key] for key in ('latitude', 'longitude', 'location_name', 'location_address')
        }
    return header


def parse_button_params(value):
    """[(button position, value)] of the `button_params` list."""
    params = []
    for item in parse_list(value, 'button_params', 0, MAX_BUTTON_PARAMS):
        item = parse_object(item, 'button_params', {'index', 'value'}, ('index', 'value'))
        index = item['index']
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < MAX_TEMPLATE_BUTTONS:
            reject(f'button_params index must be a whole number from 0 to {MAX_TEMPLATE_BUTTONS - 1}', 'button_params')
        params.append((index, parse_string(item['value'], 'button_params', MAX_BUTTON_PARAM)))
    return tuple(params)


def parse_template(conversation, payload):
    """A template reply: the template, its body parameters, header values and button values (limits checked again by the message)."""
    check_fields(payload, TEMPLATE_REPLY_KEYS, required=('template_id', 'params'))
    params = parse_list(payload['params'], 'params', 0, MAX_TEMPLATE_PARAMS)
    return ParsedReply(
        template=find_one('webvue.inbox.template', payload['template_id'], 'template_id'),
        params=tuple(parse_string(param, 'params', MAX_PARAM) for param in params),
        header=parse_header_input(conversation, payload),
        button_params=parse_button_params(payload['button_params']) if 'button_params' in payload else (),
    )


def parse_reply_to(conversation, payload):
    if 'reply_to_id' not in payload:
        return None
    target = request.env['webvue.inbox.message'].search([
        ('id', '=', parse_positive_int(payload['reply_to_id'], 'reply_to_id')), ('conversation_id', '=', conversation.id),
    ])
    if not target:
        reject('reply_to_id is not a message of this conversation', 'reply_to_id')
    return target


def parse_reply(conversation, payload):
    """The validated ParsedReply of a reply body: exactly one content member, plus an optional `reply_to_id`."""
    present = [key for key in CONTENT_KEYS if key in payload]
    if len(present) != 1:
        reject(f'a reply carries exactly one of {CONTENT_KEYS}')
    content = present[0]
    if content == 'template_id':
        return parse_template(conversation, payload)
    check_fields(payload, {content, 'reply_to_id', *(('caption',) if content == 'attachment_id' else ())})
    if content == 'attachment_id':
        reply = parse_attachment(conversation, payload)
    elif content == 'body':
        reply = ParsedReply(values={'kind': 'text', 'body': parse_string(payload['body'], 'body', MAX_BODY)})
    elif content == 'location':
        reply = ParsedReply(values=parse_location(payload['location']))
    else:
        reply = ParsedReply(values=parse_interactive(payload['interactive']))
    reply.reply_to = parse_reply_to(conversation, payload)
    return reply
