# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date
from odoo.addons.liwan_hr.serializers.recruitment.common import (
    optional_email,
    optional_id,
    optional_text,
    ref,
    reject_unknown,
)

APPLICANT_CREATE_FIELDS = ('partner_name', 'job_id', 'email_from', 'partner_phone', 'availability')
APPLICANT_PATCH_FIELDS = (
    'partner_name', 'email_from', 'partner_phone', 'availability', 'stage_id', 'priority',
)
APPLICANT_PRIORITIES = ('0', '1', '2', '3')
APPLICANT_STATUSES = ('ongoing', 'hired', 'refused', 'archived')
# Stock's own search filters (`views/hr_applicant_views.xml`), so a status filter
# returns exactly the applicants whose serialized status is that value.
STATUS_DOMAINS = {
    'ongoing': [('active', '=', True), ('date_closed', '=', False), ('refuse_reason_id', '=', False)],
    'hired': [('active', '=', True), ('date_closed', '!=', False)],
    'refused': [('active', '=', False), ('refuse_reason_id', '!=', False)],
    'archived': [('active', '=', False), ('refuse_reason_id', '=', False)],
}


def parse_status(value):
    """The status query value as a domain, or 422."""
    if value not in APPLICANT_STATUSES:
        raise ApiError(422, 'invalid', 'status is not a known applicant status', field='status')
    return list(STATUS_DOMAINS[value])


def dump_applicant(applicant, *, include_department=True, include_employee=True):
    """One applicant.

    ``hr.department`` and ``hr.employee`` are guarded by ``hr.departments.read`` and
    ``hr.employees.read``, which recruitment does not depend on, so those two references
    are only read for a caller who may read them; both keys stay present and are null
    otherwise (the same rule the employee serializer applies to its contract block).
    """
    return {
        'id': applicant.id,
        'partner_name': applicant.partner_name or '',
        'email_from': applicant.email_from or '',
        'partner_phone': applicant.partner_phone or '',
        'job': ref(applicant.job_id),
        'department': ref(applicant.department_id) if include_department else None,
        'stage': ref(applicant.stage_id),
        'status': applicant.application_status,
        'priority': applicant.priority or '0',
        'availability': fields.Date.to_string(applicant.availability) or None,
        'refuse_reason': ref(applicant.refuse_reason_id),
        'employee': ref(applicant.employee_id) if include_employee else None,
        'applied_on': iso(applicant.create_date),
        'active': bool(applicant.active),
    }


def parse_applicant_create(payload):
    reject_unknown(payload, APPLICANT_CREATE_FIELDS)
    name = payload.get('partner_name')
    if not isinstance(name, str) or not name.strip():
        raise ApiError(422, 'invalid', 'partner_name must not be empty', field='partner_name')
    if 'job_id' not in payload:
        raise ApiError(422, 'invalid', 'job_id is required', field='job_id')
    vals = {
        'partner_name': name.strip(),
        'job_id': parse_positive_int(payload['job_id'], 'job_id'),
    }
    if 'email_from' in payload:
        vals['email_from'] = optional_email(payload['email_from'], 'email_from')
    if 'partner_phone' in payload:
        vals['partner_phone'] = optional_text(payload['partner_phone'], 'partner_phone')
    if 'availability' in payload:
        vals['availability'] = parse_optional_date(payload['availability'], 'availability')
    return vals


def parse_applicant_patch(payload):
    reject_unknown(payload, APPLICANT_PATCH_FIELDS)
    vals = {}
    if 'partner_name' in payload:
        name = payload['partner_name']
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'partner_name must not be empty', field='partner_name')
        vals['partner_name'] = name.strip()
    if 'email_from' in payload:
        vals['email_from'] = optional_email(payload['email_from'], 'email_from')
    if 'partner_phone' in payload:
        vals['partner_phone'] = optional_text(payload['partner_phone'], 'partner_phone')
    if 'availability' in payload:
        vals['availability'] = parse_optional_date(payload['availability'], 'availability')
    if 'stage_id' in payload:
        vals['stage_id'] = optional_id(payload['stage_id'], 'stage_id')
    if 'priority' in payload:
        priority = payload['priority']
        if priority not in APPLICANT_PRIORITIES:
            raise ApiError(422, 'invalid', 'priority must be one of 0, 1, 2 or 3', field='priority')
        vals['priority'] = priority
    if not vals:
        raise ApiError(422, 'invalid', 'no fields to update')
    return vals


def parse_refuse(payload):
    reject_unknown(payload, ('refuse_reason_id',))
    if 'refuse_reason_id' not in payload:
        raise ApiError(422, 'invalid', 'refuse_reason_id is required', field='refuse_reason_id')
    return parse_positive_int(payload['refuse_reason_id'], 'refuse_reason_id')
