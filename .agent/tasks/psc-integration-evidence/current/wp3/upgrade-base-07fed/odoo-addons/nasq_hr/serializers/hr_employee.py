# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import email_normalize

from odoo.addons.nasq_api.controllers.common import ApiError

EMPLOYEE_FIELDS = {'name', 'work_email', 'work_phone', 'job_title', 'department_id', 'parent_id'}


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
    return vals


def parse_employee_create(payload):
    return _parse_employee_vals(payload, create=True)


def parse_employee_patch(payload):
    return _parse_employee_vals(payload, create=False)


def dump_employee(employee, *, include_access=True):
    """Serialize an hr.employee or hr.employee.public record. ``id`` is the employee id."""
    refs = employee._nasq_relation_refs()
    user = employee.user_id
    role = None
    if user:
        if user.has_group('nasq_core.group_vendor_support'):
            role = 'vendor'
        elif user.has_group('nasq_core.group_customer_admin'):
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
    }
