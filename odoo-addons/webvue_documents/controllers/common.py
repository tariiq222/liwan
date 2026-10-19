# Part of Odoo. See LICENSE file for full copyright and licensing details.
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
    value = str(args.get('archived', 'false')).lower()
    if value not in ('true', 'false', '1', '0'):
        raise ApiError(422, 'invalid', 'archived must be boolean', field='archived')
    return value in ('true', '1')
