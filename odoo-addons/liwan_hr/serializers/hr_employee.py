# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tools import email_normalize

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date

EMPLOYEE_FIELDS = {'name', 'work_email', 'work_phone', 'job_title', 'department_id', 'parent_id', 'nationality_id'}
# Writable keys of the PATCH ``contract`` object -> hr.employee field.
CONTRACT_PATCH_FIELDS = {
    'start_date': 'contract_date_start',
    'end_date': 'contract_date_end',
    'probation_end_date': 'trial_date_end',
    'identity_expiry_date': 'identification_expiration_date',
}


def _optional_id(value, field):
    if value is None or value is False or (isinstance(value, str) and not value):
        return False
    if isinstance(value, bool):
        raise ApiError(422, 'invalid', f'{field} must be an integer', field=field)
    if isinstance(value, float):
        raise ApiError(422, 'invalid', f'{field} must be an integer', field=field)
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ApiError(422, 'invalid', f'{field} must be an integer', field=field) from None
    if parsed <= 0:
        raise ApiError(422, 'invalid', f'{field} must be a positive integer', field=field)
    return parsed


def _optional_text(value, field):
    if value is None or value is False:
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f'{field} must be a string', field=field)
    return value.strip()


def _optional_email(value):
    if value is None or value is False or (isinstance(value, str) and not value):
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'work_email must be a valid email address', field='work_email')
    normalized = email_normalize(value.strip())
    if not normalized:
        raise ApiError(422, 'invalid', 'work_email must be a valid email address', field='work_email')
    return value.strip()


def _parse_employee_vals(payload, *, create):
    unknown = set(payload) - EMPLOYEE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    vals = {}
    if create or 'name' in payload:
        name = payload.get('name')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        vals['name'] = name.strip()
    for field in ('work_phone', 'job_title'):
        if field in payload:
            vals[field] = _optional_text(payload[field], field)
    if 'work_email' in payload:
        vals['work_email'] = _optional_email(payload['work_email'])
    for field in ('department_id', 'parent_id'):
        if field in payload:
            vals[field] = _optional_id(payload[field], field)
    if 'nationality_id' in payload:
        # The stock nationality (``country_id``) that payroll reads for the GOSI class.
        vals['country_id'] = _optional_id(payload['nationality_id'], 'nationality_id')
    return vals


def parse_employee_create(payload):
    return _parse_employee_vals(payload, create=True)


def _parse_contract_vals(contract):
    if not isinstance(contract, dict) or not contract:
        raise ApiError(422, 'invalid', 'contract must be a non-empty object', field='contract')
    unknown = set(contract) - set(CONTRACT_PATCH_FIELDS) - {'contract_type_id', 'notice_period_days'}
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'invalid', f"contract field {field!r} is not writable", field=f'contract.{field}')
    vals = {}
    for key, field in CONTRACT_PATCH_FIELDS.items():
        if key in contract:
            vals[field] = parse_optional_date(contract[key], f'contract.{key}')
    if 'contract_type_id' in contract:
        vals['contract_type_id'] = _optional_id(contract['contract_type_id'], 'contract.contract_type_id')
    if 'notice_period_days' in contract:
        days = contract['notice_period_days']
        if isinstance(days, bool) or not isinstance(days, int) or days < 0:
            raise ApiError(
                422, 'invalid', 'notice_period_days must be a non-negative integer',
                field='contract.notice_period_days',
            )
        vals['notice_period_days'] = days
    return vals


def parse_employee_patch(payload):
    """Employee field values of a PATCH; the optional ``contract`` object is flattened in."""
    payload = dict(payload)
    has_contract = 'contract' in payload
    contract = payload.pop('contract', None)
    vals = _parse_employee_vals(payload, create=False)
    if has_contract:
        vals.update(_parse_contract_vals(contract))
    return vals


def _date(value):
    return fields.Date.to_string(value) or None


def dump_contract(employee):
    """Contract data of the employee's current version (an hr.employee record only)."""
    contract_type = employee.contract_type_id
    return {
        'type': {'id': contract_type.id, 'name': contract_type.name} if contract_type else None,
        'start_date': _date(employee.contract_date_start),
        'end_date': _date(employee.contract_date_end),
        'probation_end_date': _date(employee.trial_date_end),
        'notice_period_days': employee.notice_period_days,
        'identity_expiry_date': _date(employee.identification_expiration_date),
    }


def _nationality(employee):
    country = employee.country_id
    return {'id': country.id, 'name': country.name} if country else None


def dump_employee(employee, *, include_access=True, include_contract=False):
    """Serialize an hr.employee or hr.employee.public record. ``id`` is the employee id.

    ``include_contract`` is the management view: it adds the contract block and the nationality,
    both private to the callers who manage employees (``None`` otherwise).
    """
    refs = employee._liwan_relation_refs()
    user = employee.user_id
    role = None
    if user and include_access:
        # Status was authorized for this employee's company by the caller. Keep
        # the linked identity lookup in that company under its native rules.
        user = user.with_company(employee.company_id)
        if user.has_group('liwan_core.group_vendor_support'):
            role = 'vendor'
        elif user.has_group('liwan_core.group_customer_admin'):
            role = 'admin'
        else:
            role = 'employee'
    return {
        'id': employee.id,
        'name': employee.name,
        'job_title': employee.job_title or '',
        'department': refs['department'],
        'work_email': employee.work_email or '',
        'work_phone': employee.work_phone or '',
        'user_id': user.id or None,
        'manager': refs['manager'],
        'active': bool(employee.active),
        'access': {
            'user_id': user.id,
            'login': user.login,
            'role': role,
            'active': bool(user.active),
        } if user and include_access else None,
        'nationality': _nationality(employee) if include_contract else None,
        'contract': dump_contract(employee) if include_contract else None,
    }
