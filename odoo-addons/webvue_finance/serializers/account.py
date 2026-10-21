# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .parsing import (
    parse_bool,
    parse_text,
    reject_unknown,
    require_keys,
    require_nonempty,
)
from odoo.addons.webvue_api.controllers.common import ApiError

ACCOUNT_CREATE_FIELDS = frozenset({'code', 'name', 'account_type', 'reconcile', 'currency'})
ACCOUNT_PATCH_FIELDS = ACCOUNT_CREATE_FIELDS


def dump_account(account):
    return {
        'id': account.id,
        'code': account.code or '',
        'name': account.name,
        'account_type': account.account_type,
        'reconcile': account.reconcile,
        'currency': account.currency_id.name or None,
        'active': account.active,
    }


def dump_accounts(accounts):
    return [dump_account(account) for account in accounts]


def _parse_account_type(value, allowed):
    if value not in allowed:
        raise ApiError(422, 'invalid', f'account_type must be one of {", ".join(sorted(allowed))}', field='account_type')
    return value


def _parse_fields(payload, account_types):
    parsed = {}
    for field, value in payload.items():
        if field in ('code', 'name'):
            parsed[field] = parse_text(value, field, required=True)
        elif field == 'account_type':
            parsed[field] = _parse_account_type(value, account_types)
        elif field == 'reconcile':
            parsed[field] = parse_bool(value, field)
        else:
            parsed[field] = None if value is None else parse_text(value, field, required=True).upper()
    return parsed


def parse_account_create(payload, account_types):
    reject_unknown(payload, ACCOUNT_CREATE_FIELDS)
    require_keys(payload, ('code', 'name', 'account_type'))
    return _parse_fields(payload, account_types)


def parse_account_patch(payload, account_types):
    reject_unknown(payload, ACCOUNT_PATCH_FIELDS)
    require_nonempty(payload)
    return _parse_fields(payload, account_types)
