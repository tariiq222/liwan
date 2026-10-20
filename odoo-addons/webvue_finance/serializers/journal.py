# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_ref
from .parsing import (
    parse_id,
    parse_text,
    reject_unknown,
    require_keys,
    require_nonempty,
)
from odoo.addons.webvue_api.controllers.common import ApiError

JOURNAL_CREATE_FIELDS = frozenset({'name', 'code', 'type', 'currency', 'default_account_id'})
# The type is chosen at creation only: it decides the sequences, the payment methods and the accounts of the journal.
JOURNAL_PATCH_FIELDS = JOURNAL_CREATE_FIELDS - {'type'}
LIQUIDITY_TYPES = frozenset({'bank', 'cash'})


def dump_journal(journal):
    return {
        'id': journal.id,
        'name': journal.name,
        'code': journal.code,
        'type': journal.type,
        'currency': (journal.currency_id or journal.company_id.currency_id).name,
        'default_account': dump_ref(journal.default_account_id),
        'active': journal.active,
    }


def dump_journals(journals):
    return [dump_journal(journal) for journal in journals]


def _parse_fields(payload, journal_types):
    parsed = {}
    for field, value in payload.items():
        if field in ('name', 'code'):
            parsed[field] = parse_text(value, field, required=True)
        elif field == 'type':
            if value not in journal_types:
                raise ApiError(422, 'invalid', f'type must be one of {", ".join(sorted(journal_types))}', field='type')
            parsed[field] = value
        elif field == 'currency':
            parsed[field] = None if value is None else parse_text(value, field, required=True).upper()
        else:
            parsed[field] = parse_id(value, field)
    return parsed


def parse_journal_create(payload, journal_types):
    reject_unknown(payload, JOURNAL_CREATE_FIELDS)
    require_keys(payload, ('name', 'code', 'type'))
    parsed = _parse_fields(payload, journal_types)
    if parsed['type'] in LIQUIDITY_TYPES and 'default_account_id' not in parsed:
        raise ApiError(422, 'invalid', 'default_account_id is required for a bank or cash journal', field='default_account_id')
    return parsed


def parse_journal_patch(payload, journal_types):
    reject_unknown(payload, JOURNAL_PATCH_FIELDS)
    require_nonempty(payload)
    return _parse_fields(payload, journal_types)
