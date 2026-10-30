# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import email_normalize

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_crm.models.crm_lead import EMAIL_MAX, NAME_MAX

DUPLICATE_PHONE = 'duplicate phone'
# Stable machine codes in `details.reason` of the 422 on `phone` and `email`; the UI translates them.
INVALID_PHONE_REASON = 'invalid_phone'
DUPLICATE_PHONE_REASON = 'duplicate_phone'
INVALID_EMAIL_REASON = 'invalid_email'
CREATE_FIELDS = ('contact_name', 'phone', 'email', 'source_id', 'user_id')
PATCH_FIELDS = ('contact_name', 'phone', 'email', 'source_id', 'stage_id')
REQUIRED_ON_CREATE = ('contact_name', 'phone')
BOOLEAN_FILTERS = ('due', 'unassigned', 'needs_manager')
ID_FILTERS = ('stage_id', 'user_id', 'source_id')
STATUS_FILTERS = ('open', 'won', 'lost', 'all')


def ref(record):
    return {'id': record.id, 'name': record.display_name} if record else None


def dump_opportunity(lead):
    return {
        'id': lead.id,
        'contact_name': lead.contact_name or '',
        'phone': lead.phone or '',
        'email': lead.email_from or '',
        'stage': ref(lead.stage_id),
        'user': ref(lead.user_id),
        'source': ref(lead.source_id),
        'package': ref(lead.liwan_package_id),
        'lost_reason': ref(lead.lost_reason_id),
        'status': lead.won_status,
        'list_price': lead.liwan_list_price,
        'discount_percent': lead.liwan_discount_percent,
        'final_price': lead.liwan_final_price,
        'expected_revenue': lead.expected_revenue,
        'attempt_count': lead.liwan_attempt_count,
        'next_call_at': iso(lead.liwan_next_call_at),
        'cycle': lead.liwan_cycle,
        'recycle_at': iso(lead.liwan_recycle_at),
        'needs_manager': lead.liwan_needs_manager,
        'active': lead.active,
        'created_at': iso(lead.create_date),
    }


def dump_view(row):
    return {
        'id': row.id,
        'user': ref(row.user_id),
        'opportunity_id': row.lead_id.id,
        'viewed_at': iso(row.viewed_at),
    }


def parse_text(value, field, maximum):
    text = value.strip() if isinstance(value, str) else ''
    if not text or len(text) > maximum:
        raise ApiError(422, 'invalid', f'must be text of 1 to {maximum} characters', field=field)
    return text


def parse_id(value, field):
    if type(value) is not int or value <= 0:
        raise ApiError(422, 'invalid', 'must be an id', field=field)
    return value


def parse_id_or_null(value, field):
    return False if value is None else parse_id(value, field)


def _email(value, field):
    if value in (None, ''):
        return False
    text = parse_text(value, field, EMAIL_MAX)
    if not email_normalize(text):
        raise ApiError(422, 'invalid', 'must be an email address', field=field, details={'reason': INVALID_EMAIL_REASON})
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
            parsed[name] = parse_text(value, name, NAME_MAX)
        elif name == 'email':
            parsed[name] = _email(value, name)
        elif name == 'stage_id':
            parsed[name] = parse_id(value, name)
        else:
            parsed[name] = parse_id_or_null(value, name)
    return parsed


def parse_list_filters(args):
    """Typed list filters from the query string: ids, booleans, ``status`` and the search text ``q``."""
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
    if 'status' in args:
        if args['status'] not in STATUS_FILTERS:
            raise ApiError(422, 'invalid', 'must be open, won, lost or all', field='status')
        filters['status'] = args['status']
    if args.get('q'):
        filters['q'] = args['q'].strip()[:NAME_MAX]
    return filters
