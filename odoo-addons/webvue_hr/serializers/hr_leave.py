# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

LEAVE_STATES = ('confirm', 'validate1', 'validate', 'refuse', 'cancel')
REQUEST_FIELDS = {'leave_type_id', 'date_from', 'date_to', 'notes', 'employee_id'}
ALLOCATION_FIELDS = {'employee_id', 'leave_type_id', 'number_of_days', 'date_from', 'date_to'}
# The employee and the leave type identify the grant; an edit changes only its days and validity.
ALLOCATION_PATCH_FIELDS = {'number_of_days', 'date_from', 'date_to'}


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_leave_type(leave_type):
    return {
        'id': leave_type.id,
        'name': leave_type.name,
        'requires_allocation': leave_type.requires_allocation,
        'support_document': leave_type.support_document,
    }


def dump_cancellation(row):
    if not row:
        return None
    return {
        'id': row.id, 'state': row.state, 'revision': row.revision, 'reason': row.reason or '',
        'requested_at': fields.Datetime.to_string(row.requested_at), 'initiator': _ref(row.initiator_id),
        'reviewed_at': fields.Datetime.to_string(row.reviewed_at) or None,
        'reviewer': _ref(row.reviewer_id), 'review_reason': row.review_reason or None,
    }


def dump_leave(leave, cancellation=None):
    """One request. The requester never sees their own request as decidable."""
    own = leave.employee_id in leave.env.user.employee_ids
    model = leave.env['webvue.hr.leave.cancellation']
    if cancellation is None:
        cancellation = model.search([('leave_id', '=', leave.id)], limit=1)
    pending = bool(cancellation and cancellation.state == 'pending')
    owner_matches = not cancellation or cancellation.requester_id == leave.employee_id.user_id
    can_review = bool(cancellation and cancellation.requester_id != leave.env.user)
    policy = leave.env['webvue.hr.leave.settings']._webvue_effective_policy(leave.company_id)
    can_request = own and model._webvue_can('hr.leave.request', company=leave.company_id)
    can_manage = not own and model._webvue_can('hr.leave.approve', company=leave.company_id)
    eligible = False
    if (can_request or can_manage) and leave.state == 'validate':
        try:
            model._webvue_owner_leave(leave)
            eligible = True
        except (AccessError, ValidationError):
            pass
    pending_owner_request = pending
    if not pending and can_request and eligible and policy == 'direct_employee':
        with model._webvue_owner_authorization(leave) as owned:
            pending_owner_request = owned.env['webvue.hr.leave.cancellation']._webvue_has_pending_owner_cancellation(owned)
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
        'can_cancel': owner_matches and not pending_owner_request and ((eligible and ((can_request and policy == 'direct_employee') or can_manage)) or (can_request and leave.state != 'validate' and bool(leave.can_cancel))),
        'cancellation_policy': policy,
        'cancellation': dump_cancellation(cancellation),
        'can_request_cancellation': bool(can_request and eligible and not pending and policy == 'manager_approval'),
        'can_approve_cancellation': bool(can_manage and can_review and pending and owner_matches and eligible and cancellation.leave_version == leave.write_date),
        'can_refuse_cancellation': bool(can_manage and can_review and pending),
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


def _allocation_days(payload):
    days = payload.get('number_of_days')
    if isinstance(days, bool) or not isinstance(days, (int, float)) or days <= 0:
        raise ApiError(422, 'invalid', "number_of_days must be a positive number", field='number_of_days')
    return float(days)


def _check_allocation_range(date_from, date_to):
    if date_to and date_to < date_from:
        raise ApiError(422, 'invalid', "date_to is before date_from", field='date_to')


def parse_allocation(payload):
    _reject_unknown(payload, ALLOCATION_FIELDS)
    days = _allocation_days(payload)
    date_from = _required_date(payload, 'date_from')
    date_to = parse_optional_date(payload.get('date_to'), 'date_to')
    _check_allocation_range(date_from, date_to)
    return {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'leave_type_id': parse_positive_int(payload.get('leave_type_id'), 'leave_type_id'),
        'number_of_days': days,
        'date_from': date_from,
        'date_to': date_to,
    }


def parse_allocation_patch(payload, allocation):
    """The edited days and validity; the range is checked against the stored values it keeps."""
    _reject_unknown(payload, ALLOCATION_PATCH_FIELDS)
    if not payload:
        raise ApiError(422, 'invalid', 'at least one field is required')
    vals = {}
    if 'number_of_days' in payload:
        vals['number_of_days'] = _allocation_days(payload)
    if 'date_from' in payload:
        vals['date_from'] = _required_date(payload, 'date_from')
    if 'date_to' in payload:
        vals['date_to'] = parse_optional_date(payload['date_to'], 'date_to') or False
    _check_allocation_range(vals.get('date_from', allocation.date_from), vals.get('date_to', allocation.date_to))
    return vals


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


def dump_settings(row):
    return {'cancellation_policy': row.cancellation_policy if row else 'manager_approval', 'revision': row.revision if row else 0}


def parse_settings(payload):
    _reject_unknown(payload, {'cancellation_policy', 'revision'})
    policy, revision = payload.get('cancellation_policy'), payload.get('revision')
    if policy not in ('manager_approval', 'direct_employee', 'manager_only'):
        raise ApiError(422, 'invalid', 'unknown cancellation policy', field='cancellation_policy')
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ApiError(422, 'invalid', 'nonnegative revision is required', field='revision')
    return {'cancellation_policy': policy, 'revision': revision}


def parse_cancellation_action(payload, decision=False, refusal=False):
    _reject_unknown(payload, {'reason', 'revision'})
    reason = parse_cancel_reason(payload.get('reason'))
    if refusal and not reason:
        raise ApiError(422, 'invalid', 'refusal reason is required', field='reason')
    revision = payload.get('revision')
    if decision or 'revision' in payload:
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise ApiError(422, 'invalid', 'positive revision is required', field='revision')
    return {'reason': reason, 'revision': revision}
