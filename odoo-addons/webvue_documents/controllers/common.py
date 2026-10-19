# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    parse_nonneg_int,
    parse_positive_int,
)


def require(capability):
    request.env['webvue.access.service']._webvue_require_capability(capability)


def current_document(document_id):
    document = (
        request.env['webvue.document']
        .with_context(active_test=False)
        .search([('id', '=', document_id)], limit=1)
    )
    if not document:
        raise ApiError(404, 'not_found', 'document not found')
    document._webvue_require('read')
    return document


def page_args(args):
    limit = min(parse_positive_int(args.get('limit', 50), 'limit'), 200)
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    if offset > 2147483647:
        raise ApiError(422, 'invalid', 'offset is too large', field='offset')
    return limit, offset


def archived_arg(args):
    return bool_arg(args, 'archived')


def list_filter_domain(args):
    """Domain terms for the list filters `visibility`, `expiring_within` and `expired`."""
    domain = []
    visibility = args.get('visibility')
    if visibility:
        values = [key for key, _label in request.env['webvue.document']._fields['visibility'].selection]
        if visibility not in values:
            raise ApiError(422, 'invalid', 'visibility is not supported', field='visibility')
        domain.append(('visibility', '=', visibility))
    today = fields.Date.context_today(request.env['webvue.document'])
    if args.get('expiring_within'):
        days = parse_positive_int(args['expiring_within'], 'expiring_within')
        if days > 365:
            raise ApiError(422, 'invalid', 'expiring_within must be 1 to 365 days', field='expiring_within')
        domain += [('expiry_date', '>=', today), ('expiry_date', '<=', today + timedelta(days=days))]
    if bool_arg(args, 'expired'):
        domain += [('expiry_date', '!=', False), ('expiry_date', '<', today)]
    return domain


def bool_arg(args, name, default='false'):
    value = str(args.get(name, default)).lower()
    if value not in ('true', 'false', '1', '0'):
        raise ApiError(422, 'invalid', f'{name} must be boolean', field=name)
    return value in ('true', '1')
