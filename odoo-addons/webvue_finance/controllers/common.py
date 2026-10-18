# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    parse_page,
    parse_positive_int,
)


def require_capability(capability):
    service = request.env['webvue.access.service']
    if not service._webvue_has_capability(request.env.user, capability):
        raise ApiError(403, 'forbidden', f'{capability} capability is required')


def parse_choice(value, allowed, field):
    """A query value that must be one of ``allowed``; None when it is absent."""
    if not value:
        return None
    if value not in allowed:
        raise ApiError(422, 'invalid', f'{field} must be one of {", ".join(sorted(allowed))}', field=field)
    return value


def _parse_day(value, field):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, 'invalid', f'{field} must be an ISO date (YYYY-MM-DD)', field=field) from None


def filter_domain(args, date_field):
    """The partner, date-range and free-text filters every finance list shares.

    ``q`` is matched by the caller, which knows its own searchable fields.
    """
    domain = []
    if args.get('partner_id'):
        domain.append(('partner_id', '=', parse_positive_int(args['partner_id'], 'partner_id')))
    date_from = _parse_day(args['date_from'], 'date_from') if args.get('date_from') else None
    date_to = _parse_day(args['date_to'], 'date_to') if args.get('date_to') else None
    if date_from and date_to and date_from > date_to:
        raise ApiError(422, 'invalid', 'date_to must be on or after date_from', field='date_to')
    if date_from:
        domain.append((date_field, '>=', date_from))
    if date_to:
        domain.append((date_field, '<=', date_to))
    return domain


def list_page(model, domain, dump_all):
    """Search one page (``limit``/``offset`` of the request) and wrap it in the {items, total} envelope."""
    limit, offset = parse_page(request.httprequest.args)
    records = request.env[model].search(domain, limit=limit, offset=offset)
    return {'items': dump_all(records), 'total': request.env[model].search_count(domain)}
