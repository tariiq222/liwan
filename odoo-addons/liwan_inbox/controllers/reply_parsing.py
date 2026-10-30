# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of the reply body (packages/contracts InboxReplyCreateSchema): every limit is checked here again."""
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_inbox.adapters import media_rules
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    find_one,
    reject,
)
from odoo.addons.liwan_inbox.models.abstract_interactive import NO_PRODUCT_BODY
from odoo.addons.liwan_inbox.models.constants import FLOWS_FEATURE

MAX_BODY = 4096
MAX_CAPTION = 1024
MAX_TEMPLATE_PARAMS = 20
MAX_PARAM = 1024
MAX_HEADER_PARAM = 60
MAX_BUTTON_PARAMS = 3
MAX_BUTTON_PARAM = 2000
MAX_COUPON = 15
MAX_OTP_CODE = 15
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
CONTENT_KEYS = ('body', 'attachment_id', 'location', 'interactive', 'commerce', 'template_id')
INTERACTIVE_TYPES = ('buttons', 'list', 'cta_url', 'flow')
MAX_FLOW_CTA = 30
MAX_RETAILER_ID = 100
RETAILER_ID = re.compile(r'^[A-Za-z0-9._-]+$')
MAX_COMMERCE_PRODUCTS = 30
COMMERCE_KEYS = {
    'product': ('body', 'footer', 'product_retailer_id'),
    'product_list': ('header', 'body', 'footer', 'sections'),
    'catalog_message': ('body', 'footer', 'thumbnail_product_retailer_id'),
}
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


def parse_flow(value, channel):
    """A form message: a published form of `channel` (of any channel when none is given) and the text of its button."""
    value = parse_object(value, 'interactive', SHARED_INTERACTIVE_KEYS | {'flow_id', 'cta'}, ('flow_id', 'cta'))
    request.env['liwan.entitlement.service'].require(FLOWS_FEATURE)
    flow = find_one('liwan.inbox.flow', value['flow_id'], 'flow_id')
    if not flow.sendable or (channel and flow.channel_id != channel):
        reject('flow_id is not a published form of this channel', 'flow_id')
    return {'flow_id': flow.id, 'flow_cta': parse_string(value['cta'], 'cta', MAX_FLOW_CTA)}


PARSE_INTERACTIVE = {'buttons': parse_buttons, 'list': parse_list_rows, 'cta_url': parse_cta_url}


def parse_interactive(value, channel=None):
    """Interactive content as model values; `channel` is where a form message will be sent (None: not known yet)."""
    if not isinstance(value, dict) or value.get('type') not in INTERACTIVE_TYPES:
        reject(f'interactive.type must be one of {INTERACTIVE_TYPES}', 'interactive')
    specific = parse_flow(value, channel) if value['type'] == 'flow' else PARSE_INTERACTIVE[value['type']](value)
    options = specific.pop('options', [])
    return {
        'kind': 'interactive', 'interactive_type': value['type'],
        'body': parse_string(value.get('body'), 'body', MAX_INTERACTIVE_BODY),
        'interactive_header': parse_string(value.get('header'), 'header', MAX_INTERACTIVE_AFFIX, nullable=True) or False,
        'interactive_footer': parse_string(value.get('footer'), 'footer', MAX_INTERACTIVE_AFFIX, nullable=True) or False,
        'option_ids': [(0, 0, row) for row in options],
        **specific,
    }


def parse_retailer_id(value, key, nullable=False):
    if value is None and nullable:
        return None
    retailer_id = parse_string(value, key, MAX_RETAILER_ID)
    if not RETAILER_ID.match(retailer_id):
        reject(f'{key} may contain only letters, digits, dot, underscore and dash', key)
    return retailer_id


def parse_product_sections(value):
    """The rows of a product list: one row per product, titled by its section; a product appears once."""
    options = []
    for section in parse_list(value, 'sections', 1, MAX_SECTIONS):
        section = parse_object(section, 'sections', {'title', 'product_retailer_ids'}, ('title', 'product_retailer_ids'))
        title = parse_string(section['title'], 'sections', MAX_SECTION_TITLE)
        for retailer_id in parse_list(section['product_retailer_ids'], 'product_retailer_ids', 1, MAX_COMMERCE_PRODUCTS):
            parsed = parse_retailer_id(retailer_id, 'product_retailer_ids')
            options.append(option(len(options), parsed, parsed, title))
    ids = [row['option_id'] for row in options]
    if len(ids) > MAX_COMMERCE_PRODUCTS or len(set(ids)) != len(ids):
        reject(f'a product list holds at most {MAX_COMMERCE_PRODUCTS} different products', 'sections')
    return options


def parse_commerce(value):
    """Commerce content (a product, a product list or the catalog) as message model values; the products are not checked here."""
    if not isinstance(value, dict) or value.get('type') not in COMMERCE_KEYS:
        reject(f'commerce.type must be one of {tuple(COMMERCE_KEYS)}', 'commerce')
    kind = value['type']
    value = parse_object(value, 'commerce', {'type', *COMMERCE_KEYS[kind]}, ('type', *COMMERCE_KEYS[kind]))
    body = parse_string(value['body'], 'body', MAX_INTERACTIVE_BODY, nullable=kind == 'product')
    values = {
        'kind': kind, 'interactive_type': kind, 'body': body or NO_PRODUCT_BODY,
        'interactive_footer': parse_string(value['footer'], 'footer', MAX_INTERACTIVE_AFFIX, nullable=True) or False,
    }
    if kind == 'product':
        retailer_id = parse_retailer_id(value['product_retailer_id'], 'product_retailer_id')
        options = [option(0, retailer_id, retailer_id)]
    elif kind == 'catalog_message':
        thumbnail = parse_retailer_id(value['thumbnail_product_retailer_id'], 'thumbnail_product_retailer_id', nullable=True)
        options = [option(0, thumbnail, thumbnail)] if thumbnail else []
    else:
        values['interactive_header'] = parse_string(value['header'], 'header', MAX_INTERACTIVE_AFFIX)
        options = parse_product_sections(value['sections'])
    return {**values, 'option_ids': [(0, 0, row) for row in options]}


def check_commerce(conversation, values):
    """422 naming `commerce` unless the conversation's channel has a catalog that can send every product of `values`."""
    channel = conversation.channel_id
    if not channel._liwan_catalog_id():
        reject('this channel has no product catalog', 'commerce')
    try:
        request.env['liwan.inbox.message']._liwan_check_commerce(channel, [command[2]['option_id'] for command in values['option_ids']])
    except ValidationError as error:
        reject(str(error), 'commerce')


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


def parse_button_params(value, template):
    """[(button index, value)] of the `button_params` list; a coupon code is shorter than a link suffix."""
    kinds = dict(template._liwan_button_needs())
    params = []
    for item in parse_list(value, 'button_params', 0, MAX_BUTTON_PARAMS):
        item = parse_object(item, 'button_params', {'index', 'value'}, ('index', 'value'))
        index = item['index']
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < MAX_TEMPLATE_BUTTONS:
            reject(f'button_params index must be a whole number from 0 to {MAX_TEMPLATE_BUTTONS - 1}', 'button_params')
        maximum = MAX_COUPON if kinds.get(index) == 'copy_code' else MAX_BUTTON_PARAM
        params.append((index, parse_string(item['value'], 'button_params', maximum)))
    return tuple(params)


def parse_template(conversation, payload):
    """A template reply: the template, its body parameters, header values and button values (limits checked again by the message)."""
    check_fields(payload, TEMPLATE_REPLY_KEYS, required=('template_id', 'params'))
    template = find_one('liwan.inbox.template', payload['template_id'], 'template_id')
    if not template.supported:
        reject('this template has parts LiwanOS cannot send; synchronise or recreate it', 'template_id')
    params = parse_list(payload['params'], 'params', 0, MAX_TEMPLATE_PARAMS)
    limit = MAX_OTP_CODE if template.category == 'authentication' else MAX_PARAM
    return ParsedReply(
        template=template,
        params=tuple(parse_string(param, 'params', limit) for param in params),
        header=parse_header_input(conversation, payload),
        button_params=parse_button_params(payload['button_params'], template) if 'button_params' in payload else (),
    )


def parse_reply_to(conversation, payload):
    if 'reply_to_id' not in payload:
        return None
    target = request.env['liwan.inbox.message'].search([
        ('id', '=', parse_positive_int(payload['reply_to_id'], 'reply_to_id')), ('conversation_id', '=', conversation.id),
    ])
    if not target:
        reject('reply_to_id is not a message of this conversation', 'reply_to_id')
    return target


def parse_reply(conversation, payload):
    """The validated ParsedReply of a reply body: exactly one content member, plus an optional `reply_to_id`."""
    present = [key for key in CONTENT_KEYS if key in payload]
    if present == ['body', 'attachment_id']:
        reject('a file carries its text as `caption`, not `body`', 'caption')
    if len(present) != 1:
        reject(f"a reply carries exactly one of: {', '.join(CONTENT_KEYS)}")
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
    elif content == 'commerce':
        reply = ParsedReply(values=parse_commerce(payload['commerce']))
        check_commerce(conversation, reply.values)
    else:
        reply = ParsedReply(values=parse_interactive(payload['interactive'], conversation.channel_id))
    reply.reply_to = parse_reply_to(conversation, payload)
    return reply
