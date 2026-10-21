# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

LEAVE_STATES = ('confirm', 'validate1', 'validate', 'refuse', 'cancel')
REQUEST_FIELDS = {'leave_type_id', 'date_from', 'date_to', 'notes', 'employee_id'}
ALLOCATION_FIELDS = {'employee_id', 'leave_type_id', 'number_of_days', 'date_from', 'date_to'}


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_leave_type(leave_type):
    return {
        'id': leave_type.id,
        'name': leave_type.name,
        'requires_allocation': leave_type.requires_allocation,
        'support_document': leave_type.support_document,
    }


def dump_leave(leave):
    """One request. The requester never sees their own request as decidable."""
    own = leave.employee_id in leave.env.user.employee_ids
    return {
        'id': leave.id,
        'employee': _ref(leave.employee_id),
        'leave_type': _ref(leave.holiday_status_id),
        'date_from': fields.Date.to_string(leave.request_date_from),
        'date_to': fields.Date.to_string(leave.request_date_to),
        'number_of_days': leave.number_of_days,
        'state': leave.state,
        'notes': leave.notes or '',
        'can_approve': bool(leave.can_approve or leave.can_validate) and not own,
        'can_refuse': bool(leave.can_refuse) and not own,
        'can_cancel': bool(leave.can_cancel),
        # A request still waiting for a decision is withdrawn by deleting it; stock only
        # offers cancel once a decision exists.
        'can_withdraw': own and leave.state == 'confirm',
    }


def dump_balance(leave_type_id, name, data):
    return {
        'leave_type': {'id': leave_type_id, 'name': name},
        'allocated': data['max_leaves'],
        'taken': data['leaves_taken'],
        'pending': data['leaves_requested'],
        'remaining': data['virtual_remaining_leaves'],
    }


def dump_allocation(allocation):
    return {
        'id': allocation.id,
        'employee': _ref(allocation.employee_id),
        'leave_type': _ref(allocation.holiday_status_id),
        'number_of_days': allocation.number_of_days,
        'date_from': fields.Date.to_string(allocation.date_from),
        'date_to': fields.Date.to_string(allocation.date_to) or None,
        'state': allocation.state,
    }


def _reject_unknown(payload, allowed):
    extra = set(payload) - allowed
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)


def _required_date(payload, field):
    value = parse_optional_date(payload.get(field), field)
    if not value:
        raise ApiError(422, 'invalid', f"{field} is required", field=field)
    return value


def _notes(payload):
    notes = payload.get('notes')
    if notes in (None, False):
        return ''
    if not isinstance(notes, str):
        raise ApiError(422, 'invalid', "notes must be a string", field='notes')
    return notes.strip()


def _optional_employee_id(payload):
    value = payload.get('employee_id')
    return parse_positive_int(value, 'employee_id') if value not in (None, False, '') else None


def parse_leave_request(payload):
    _reject_unknown(payload, REQUEST_FIELDS)
    date_from = _required_date(payload, 'date_from')
    date_to = _required_date(payload, 'date_to')
    if date_to < date_from:
        raise ApiError(422, 'invalid', "date_to is before date_from", field='date_to')
    return {
        'leave_type_id': parse_positive_int(payload.get('leave_type_id'), 'leave_type_id'),
        'date_from': date_from,
        'date_to': date_to,
        'notes': _notes(payload),
        'employee_id': _optional_employee_id(payload),
    }


def parse_allocation(payload):
    _reject_unknown(payload, ALLOCATION_FIELDS)
    days = payload.get('number_of_days')
    if isinstance(days, bool) or not isinstance(days, (int, float)) or days <= 0:
        raise ApiError(422, 'invalid', "number_of_days must be a positive number", field='number_of_days')
    date_from = _required_date(payload, 'date_from')
    date_to = parse_optional_date(payload.get('date_to'), 'date_to')
    if date_to and date_to < date_from:
        raise ApiError(422, 'invalid', "date_to is before date_from", field='date_to')
    return {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'leave_type_id': parse_positive_int(payload.get('leave_type_id'), 'leave_type_id'),
        'number_of_days': float(days),
        'date_from': date_from,
        'date_to': date_to,
        'notes': _notes(payload),
    }


def parse_cancel_reason(value):
    if value is None or value is False:
        return ''
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'reason must be a string', field='reason')
    return value.strip()


def parse_state_filter(value):
    """Comma separated states, e.g. ``confirm,validate1``; ``None`` when no filter is given."""
    if value in (None, ''):
        return None
    states = [part.strip() for part in value.split(',')]
    for state in states:
        if state not in LEAVE_STATES:
            raise ApiError(422, 'invalid', f"state must be one of {', '.join(LEAVE_STATES)}", field='state')
    return states
