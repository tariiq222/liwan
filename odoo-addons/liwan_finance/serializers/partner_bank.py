# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .parsing import parse_text, reject_unknown, require_keys
from odoo.addons.liwan_api.controllers.common import ApiError

WRITABLE = frozenset({'acc_number', 'holder_name', 'bank_name', 'bic'})
SAUDI_IBAN_LENGTH = 24
MAX_ACCOUNT_LENGTH = 34


def sanitize_account(value):
    """The account number as stored for comparison: upper case, without spaces and dashes."""
    return ''.join(char for char in value.upper() if char.isalnum())


def _iban_checksum_ok(iban):
    moved = iban[4:] + iban[:4]
    digits = ''.join(str(int(char, 36)) for char in moved)
    return int(digits) % 97 == 1


def parse_account_number(value):
    """A Saudi IBAN (``SA`` + 22 characters, mod-97 valid) or any other account number up to 34 characters."""
    account = sanitize_account(parse_text(value, 'acc_number', required=True))
    if len(account) > MAX_ACCOUNT_LENGTH:
        raise ApiError(422, 'invalid', f'acc_number must be at most {MAX_ACCOUNT_LENGTH} characters', field='acc_number')
    if account.startswith('SA') and (len(account) != SAUDI_IBAN_LENGTH or not _iban_checksum_ok(account)):
        raise ApiError(422, 'invalid', 'acc_number is not a valid Saudi IBAN', field='acc_number')
    return account


def dump_partner_bank(bank_account):
    return {
        'id': bank_account.id,
        'acc_number': bank_account.sanitized_acc_number or bank_account.acc_number,
        'holder_name': bank_account.acc_holder_name or '',
        'bank_name': bank_account.bank_id.name or '',
        'bic': bank_account.bank_id.bic or '',
        'active': bank_account.active,
    }


def dump_partner_banks(bank_accounts):
    return [dump_partner_bank(bank_account) for bank_account in bank_accounts]


def _parse_fields(payload):
    parsed = {}
    if 'acc_number' in payload:
        parsed['acc_number'] = parse_account_number(payload['acc_number'])
    for field in ('holder_name', 'bank_name', 'bic'):
        if field in payload:
            parsed[field] = parse_text(payload[field], field)
    if parsed.get('bic'):
        parsed['bic'] = sanitize_account(parsed['bic'])
    return parsed


def parse_partner_bank_create(payload):
    reject_unknown(payload, WRITABLE)
    require_keys(payload, ('acc_number',))
    return _parse_fields(payload)


def parse_partner_bank_patch(payload):
    reject_unknown(payload, WRITABLE)
    return _parse_fields(payload)
