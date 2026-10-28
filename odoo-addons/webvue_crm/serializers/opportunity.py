# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import email_normalize

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso

NAME_MAX = 200
EMAIL_MAX = 254
DUPLICATE_PHONE = 'duplicate phone'
CREATE_FIELDS = ('contact_name', 'phone', 'email', 'source_id', 'user_id')
PATCH_FIELDS = ('contact_name', 'phone', 'email', 'source_id', 'stage_id')
REQUIRED_ON_CREATE = ('contact_name', 'phone')
BOOLEAN_FILTERS = ('due', 'unassigned', 'needs_manager')
ID_FILTERS = ('stage_id', 'user_id', 'source_id')


def _ref(record):
    return {'id': record.id, 'name': record.display_name} if record else None


def dump_opportunity(lead):
    return {
        'id': lead.id,
        'contact_name': lead.contact_name or '',
        'phone': lead.phone or '',
        'email': lead.email_from or '',
        'stage': _ref(lead.stage_id),
        'user': _ref(lead.user_id),
        'source': _ref(lead.source_id),
        'package': _ref(lead.webvue_package_id),
        'lost_reason': _ref(lead.lost_reason_id),
        'status': lead.won_status,
        'list_price': lead.webvue_list_price,
        'discount_percent': lead.webvue_discount_percent,
        'final_price': lead.webvue_final_price,
        'expected_revenue': lead.expected_revenue,
        'attempt_count': lead.webvue_attempt_count,
        'next_call_at': iso(lead.webvue_next_call_at),
        'cycle': lead.webvue_cycle,
        'recycle_at': iso(lead.webvue_recycle_at),
        'needs_manager': lead.webvue_needs_manager,
        'active': lead.active,
        'created_at': iso(lead.create_date),
    }


def dump_view(row):
    return {
        'id': row.id,
        'user': _ref(row.user_id),
        'opportunity_id': row.lead_id.id,
        'viewed_at': iso(row.viewed_at),
    }


def _text(value, field, maximum):
    text = value.strip() if isinstance(value, str) else ''
    if not text or len(text) > maximum:
        raise ApiError(422, 'invalid', f'must be text of 1 to {maximum} characters', field=field)
    return text


def _id(value, field):
    if type(value) is not int or value <= 0:
        raise ApiError(422, 'invalid', 'must be an id', field=field)
    return value


def _id_or_null(value, field):
    return False if value is None else _id(value, field)


def _email(value, field):
    if value in (None, ''):
        return False
    text = _text(value, field, EMAIL_MAX)
    if not email_normalize(text):
        raise ApiError(422, 'invalid', 'must be an email address', field=field)
    return text


def parse_opportunity_body(payload, creating):
    """Whitelisted, typed values of a create or patch body (field names as on the wire).

    ``phone`` is returned raw: the controller normalises it in the company's country.
    """
    allowed = CREATE_FIELDS if creating else PATCH_FIELDS
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    if creating:
        missing = [name for name in REQUIRED_ON_CREATE if name not in payload]
        if missing:
            raise ApiError(422, 'invalid', 'field is required', field=missing[0])
    elif not payload:
        raise ApiError(422, 'invalid', 'nothing to change')
    parsed = {}
    for name, value in payload.items():
        if name in ('contact_name', 'phone'):
            parsed[name] = _text(value, name, NAME_MAX)
        elif name == 'email':
            parsed[name] = _email(value, name)
        elif name == 'stage_id':
            parsed[name] = _id(value, name)
        else:
            parsed[name] = _id_or_null(value, name)
    return parsed


def parse_list_filters(args):
    """Typed list filters from the query string: ids, booleans and the search text ``q``."""
    filters = {}
    for name in ID_FILTERS:
        if name in args:
            raw = args[name]
            if not (raw.isascii() and raw.isdecimal()) or int(raw) <= 0:
                raise ApiError(422, 'invalid', 'must be an id', field=name)
            filters[name] = int(raw)
    for name in BOOLEAN_FILTERS:
        if name in args:
            if args[name] not in ('true', 'false'):
                raise ApiError(422, 'invalid', 'must be true or false', field=name)
            filters[name] = args[name] == 'true'
    if args.get('q'):
        filters['q'] = args['q'].strip()[:NAME_MAX]
    return filters
