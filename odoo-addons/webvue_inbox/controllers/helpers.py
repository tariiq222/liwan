# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request parsing shared by the inbox controllers."""
import re
from contextlib import contextmanager

from psycopg2.errors import UniqueViolation

from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int

PROVIDER_ID = re.compile(r'^\d{5,32}$')
CONVERSATION_STATES = ('open', 'pending', 'resolved', 'closed')


def reject(message, field=None):
    """Answer 422 `invalid` naming `field`."""
    raise ApiError(422, 'invalid', message, field=field)


def check_fields(payload, allowed, required=()):
    """Reject unknown and missing keys of a JSON body with a 422 naming the field."""
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        reject(f'field {unknown[0]!r} is not accepted', unknown[0])
    missing = [key for key in required if key not in payload]
    if missing:
        reject(f'field {missing[0]!r} is required', missing[0])
    if not payload:
        reject('no fields to update')


def parse_text(payload, key, maximum, minimum=1):
    value = payload[key].strip() if isinstance(payload[key], str) else None
    if value is None or not minimum <= len(value) <= maximum:
        reject(f'{key} must be a string of {minimum} to {maximum} characters', key)
    return value


def parse_provider_id(payload, key):
    value = payload[key]
    if not isinstance(value, str) or not PROVIDER_ID.match(value):
        reject(f'{key} must be 5 to 32 digits', key)
    return value


def parse_ids(value, field):
    if not isinstance(value, list):
        reject(f'{field} must be a list of ids', field)
    return sorted({parse_positive_int(item, field) for item in value})


def find_ids(model, ids, field):
    """The records of `model` with `ids` that the caller sees; 422 when any is missing."""
    records = request.env[model].search([('id', 'in', ids)])
    if len(records) != len(ids):
        reject(f'{field} names a record that does not exist', field)
    return records


def find_one(model, record_id, field):
    return find_ids(model, [parse_positive_int(record_id, field)], field)


def not_found():
    return MissingError(request.env._('Record does not exist'))


@contextmanager
def unique_as_invalid(field, message):
    """Turn a unique-constraint violation raised by the writes inside the block into a 422."""
    try:
        with request.env.cr.savepoint():
            yield
            request.env.flush_all()
    except UniqueViolation:
        reject(message, field)


def visible_conversation(conversation_id):
    conversation = request.env['webvue.inbox.conversation']._webvue_search_visible(
        [('id', '=', conversation_id)], limit=1,
    )
    if not conversation:
        raise not_found()
    return conversation


def get_channel(channel_id):
    """A channel of the caller's companies; another company's channel is a plain 404."""
    channel = request.env['webvue.inbox.channel'].search([('id', '=', channel_id)], limit=1)
    if not channel:
        raise not_found()
    return channel


def visible_message(message_id):
    message = request.env['webvue.inbox.message'].search([('id', '=', message_id)], limit=1)
    if not message:
        raise not_found()
    visible_conversation(message.conversation_id.id)
    return message


def no_content():
    return request.make_json_response('', status=204)
