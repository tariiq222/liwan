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
DISPOSE_FIELDS = frozenset({'date_remove', 'sale_value', 'sale_account_id', 'plus_account_id', 'min_account_id', 'note'})
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
        'plus_value_account': dump_ref(profile.account_plus_value_id),
        'min_value_account': dump_ref(profile.account_min_value_id),
        'active': profile.active,
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
        'date_remove': dump_day(asset.date_remove),
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


def parse_asset_dispose(payload):
    """Validate a disposal body: the date, what the asset was sold for and where the proceeds and the gain or loss go."""
    reject_unknown(payload, DISPOSE_FIELDS)
    require_keys(payload, ('date_remove',))
    parsed = {'date_remove': parse_day(payload['date_remove'], 'date_remove'), 'sale_value': 0.0}
    if 'sale_value' in payload:
        parsed['sale_value'] = parse_number(payload['sale_value'], 'sale_value', minimum=0)
    for field in ('sale_account_id', 'plus_account_id', 'min_account_id'):
        if payload.get(field) is not None:
            parsed[field] = parse_id(payload[field], field)
    if parsed['sale_value'] and 'sale_account_id' not in parsed:
        raise ApiError(422, 'invalid', 'sale_account_id is required when the asset is sold', field='sale_account_id')
    if 'note' in payload:
        parsed['note'] = parse_text(payload['note'], 'note')
    return parsed


PROFILE_FIELDS = frozenset({
    'name', 'asset_account_id', 'depreciation_account_id', 'expense_account_id', 'journal_id', 'method', 'method_time',
    'method_number', 'method_period', 'prorata', 'plus_value_account_id', 'min_value_account_id',
})
PROFILE_ACCOUNT_FIELDS = {
    'asset_account_id': 'account_asset_id', 'depreciation_account_id': 'account_depreciation_id',
    'expense_account_id': 'account_expense_depreciation_id', 'plus_value_account_id': 'account_plus_value_id',
    'min_value_account_id': 'account_min_value_id',
}
# What the depreciation of a running asset is computed and booked with: fixed once an asset uses the profile.
PROFILE_LOCKED_WHEN_USED = (
    'asset_account_id', 'depreciation_account_id', 'expense_account_id', 'journal_id', 'method', 'method_time',
    'method_number', 'method_period', 'prorata',
)
PROFILE_CHOICES = {
    'method': ('linear', 'degressive'),
    'method_time': ('year', 'number'),
    'method_period': ('month', 'quarter', 'year'),
}


def _parse_profile_fields(payload):
    parsed = {}
    for field, value in payload.items():
        if field == 'name':
            parsed[field] = parse_text(value, field, required=True)
        elif field in PROFILE_CHOICES:
            if value not in PROFILE_CHOICES[field]:
                raise ApiError(422, 'invalid', f'{field} must be one of {", ".join(PROFILE_CHOICES[field])}', field=field)
            parsed[field] = value
        elif field == 'method_number':
            parsed[field] = int(parse_number(value, field, minimum=1, maximum=1200))
            if parsed[field] != value:
                raise ApiError(422, 'invalid', f'{field} must be a whole number', field=field)
        elif field == 'prorata':
            if not isinstance(value, bool):
                raise ApiError(422, 'invalid', f'{field} must be a boolean', field=field)
            parsed[field] = value
        elif value is None and field in ('plus_value_account_id', 'min_value_account_id'):
            parsed[field] = None
        else:
            parsed[field] = parse_id(value, field)
    return parsed


def parse_profile_create(payload):
    reject_unknown(payload, PROFILE_FIELDS)
    require_keys(payload, ('name', 'asset_account_id', 'depreciation_account_id', 'expense_account_id', 'journal_id'))
    return _parse_profile_fields(payload)


def parse_profile_patch(payload):
    reject_unknown(payload, PROFILE_FIELDS)
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')
    return _parse_profile_fields(payload)
