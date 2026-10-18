# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref
from .parsing import (
    parse_day,
    parse_id,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.webvue_api.controllers.common import ApiError

CREATE_FIELDS = frozenset({'profile_id', 'name', 'code', 'purchase_value', 'salvage_value', 'date_start', 'partner_id', 'note'})
COMPUTE_FIELDS = frozenset({'date'})
ASSET_CODE_SIZE = 32


def dump_asset_profile(profile):
    return {
        'id': profile.id,
        'name': profile.name,
        'method': profile.method,
        'method_time': profile.method_time,
        'method_number': profile.method_number,
        'method_period': profile.method_period,
        'prorata': profile.prorata,
        'asset_account': dump_ref(profile.account_asset_id),
        'depreciation_account': dump_ref(profile.account_depreciation_id),
        'expense_account': dump_ref(profile.account_expense_depreciation_id),
        'journal': dump_ref(profile.journal_id),
    }


def dump_asset_profiles(profiles):
    return [dump_asset_profile(profile) for profile in profiles]


def dump_asset(asset):
    return {
        'id': asset.id,
        'name': asset.name,
        'code': asset.code or '',
        'state': asset.state,
        'profile': dump_ref(asset.profile_id),
        'partner': dump_ref(asset.partner_id),
        'date_start': dump_day(asset.date_start),
        'currency': asset.currency_id.name,
        'purchase_value': asset.purchase_value,
        'salvage_value': asset.salvage_value,
        'depreciation_base': asset.depreciation_base,
        'value_depreciated': asset.value_depreciated,
        'value_residual': asset.value_residual,
    }


def dump_assets(assets):
    return [dump_asset(asset) for asset in assets]


def dump_depreciation_line(line):
    return {
        'id': line.id,
        'type': line.type,
        'date': dump_day(line.line_date),
        'amount': line.amount,
        'depreciated_value': line.depreciated_value,
        'remaining_value': line.remaining_value,
        'posted': line.move_check,
        'entry': dump_ref(line.move_id),
    }


def dump_asset_detail(asset):
    """The asset with its depreciation board, oldest line first."""
    return {
        **dump_asset(asset),
        'note': asset.note or '',
        'method': asset.method,
        'method_time': asset.method_time,
        'method_number': asset.method_number,
        'method_period': asset.method_period,
        'prorata': asset.prorata,
        'lines': [dump_depreciation_line(line) for line in asset.depreciation_line_ids.sorted(lambda line: (line.line_date, line.id))],
    }


def parse_asset_create(payload):
    """Validate an asset creation body (shape only; the profile and partner are resolved by the route)."""
    reject_unknown(payload, CREATE_FIELDS)
    require_keys(payload, ('profile_id', 'name', 'purchase_value', 'date_start'))
    parsed = {
        'profile_id': parse_id(payload['profile_id'], 'profile_id'),
        'name': parse_text(payload['name'], 'name', required=True),
        'purchase_value': parse_number(payload['purchase_value'], 'purchase_value', minimum=0, exclusive_minimum=True),
        'date_start': parse_day(payload['date_start'], 'date_start'),
    }
    if 'code' in payload:
        parsed['code'] = parse_text(payload['code'], 'code')
        if len(parsed['code']) > ASSET_CODE_SIZE:
            raise ApiError(422, 'invalid', f'code must be at most {ASSET_CODE_SIZE} characters', field='code')
    if 'salvage_value' in payload:
        parsed['salvage_value'] = parse_number(payload['salvage_value'], 'salvage_value', minimum=0)
        if parsed['salvage_value'] > parsed['purchase_value']:
            raise ApiError(422, 'invalid', 'salvage_value must not exceed purchase_value', field='salvage_value')
    if payload.get('partner_id') is not None:
        parsed['partner_id'] = parse_id(payload['partner_id'], 'partner_id')
    if 'note' in payload:
        parsed['note'] = parse_text(payload['note'], 'note')
    return parsed


def parse_compute_depreciation(payload):
    reject_unknown(payload, COMPUTE_FIELDS)
    require_keys(payload, ('date',))
    return {'date': parse_day(payload['date'], 'date')}
