# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Query parsing the report routes share: the posting filter and the receivable/payable kind."""
from odoo.http import request

from .common import parse_choice, parse_day
from odoo.addons.liwan_api.controllers.common import ApiError

TARGET_MOVES = ('posted', 'all')
ACCOUNT_TYPES = {'receivable': 'asset_receivable', 'payable': 'liability_payable'}


def parse_only_posted():
    """``target_move`` of the request: ``posted`` (default) or ``all``; True when only posted entries count."""
    return (parse_choice(request.httprequest.args.get('target_move'), TARGET_MOVES, 'target_move') or 'posted') == 'posted'


def parse_kind(required=True):
    """``kind`` of the request as an Odoo account type; ``receivable`` when absent and not required."""
    kind = parse_choice(request.httprequest.args.get('kind'), ACCOUNT_TYPES, 'kind')
    if kind is None and required:
        raise ApiError(422, 'invalid', 'kind is required', field='kind')
    return ACCOUNT_TYPES[kind or 'receivable']


def parse_required_day(field):
    value = request.httprequest.args.get(field)
    if not value:
        raise ApiError(422, 'invalid', f'{field} is required', field=field)
    return parse_day(value, field)
