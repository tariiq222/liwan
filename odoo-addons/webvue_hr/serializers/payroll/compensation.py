# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.models.hr_compensation import (
    RELATIONSHIP_TYPES,
    normalize_iban,
)
from odoo.addons.webvue_hr.serializers.assets.common import ref, reject_unknown
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date
from odoo.addons.webvue_hr.serializers.payroll.currency import currency_code

AMOUNT_FIELDS = ('basic_wage', 'housing_allowance', 'transport_allowance', 'other_allowance')
COMPENSATION_FIELDS = (*AMOUNT_FIELDS, 'iban', 'bank_id', 'gosi_number', 'gosi_registration_date', 'relationship_type')
RELATIONSHIP_KEYS = frozenset(key for key, _label in RELATIONSHIP_TYPES)


def dump_compensation(record):
    employee = record.employee_id
    country = employee.current_version_id.country_id
    return {
        'employee': ref(employee),
        **{name: record[name] for name in AMOUNT_FIELDS},
        'fixed_wage': float(record._webvue_fixed_wage()),
        'iban': record.iban or None,
        'bank': ref(record.bank_id),
        'gosi_number': record.gosi_number or None,
        'gosi_registration_date': record.gosi_registration_date.isoformat() if record.gosi_registration_date else None,
        'nationality': {'id': country.id, 'name': country.name, 'code': country.code} if country else None,
        'relationship_type': record.relationship_type,
        'currency': currency_code(employee.company_id),
    }


def _amount(value, field, *, minimum_exclusive):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(422, 'invalid', f'{field} must be a number', field=field)
    if not math.isfinite(value):
        raise ApiError(422, 'invalid', f'{field} must be a finite number', field=field)
    if value < 0 or (minimum_exclusive and value == 0):
        raise ApiError(422, 'invalid', f'{field} must be {"positive" if minimum_exclusive else "zero or more"}', field=field)
    return value


def parse_compensation(payload):
    """Every key is required; ``iban``, ``bank_id`` and the GOSI keys may be null."""
    reject_unknown(payload, COMPENSATION_FIELDS)
    missing = [name for name in COMPENSATION_FIELDS if name not in payload]
    if missing:
        raise ApiError(422, 'invalid', f'{missing[0]} is required', field=missing[0])
    vals = {name: _amount(payload[name], name, minimum_exclusive=name == 'basic_wage') for name in AMOUNT_FIELDS}
    iban = payload['iban']
    if iban is not None and not isinstance(iban, str):
        raise ApiError(422, 'invalid', 'iban must be a string', field='iban')
    try:
        vals['iban'] = normalize_iban(iban) or False
    except ValueError as error:
        raise ApiError(422, 'invalid', str(error), field='iban') from None
    bank_id = payload['bank_id']
    vals['bank_id'] = parse_positive_int(bank_id, 'bank_id') if bank_id is not None else False
    gosi = payload['gosi_number']
    if gosi is not None and not isinstance(gosi, str):
        raise ApiError(422, 'invalid', 'gosi_number must be a string', field='gosi_number')
    vals['gosi_number'] = (gosi or '').strip() or False
    vals['gosi_registration_date'] = parse_optional_date(payload['gosi_registration_date'], 'gosi_registration_date')
    relationship = payload['relationship_type']
    if relationship not in RELATIONSHIP_KEYS:
        raise ApiError(422, 'invalid', 'relationship_type is not a known relationship', field='relationship_type')
    vals['relationship_type'] = relationship
    return vals
