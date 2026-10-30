# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.recruitment.common import (
    optional_id,
    optional_text,
    ref,
    reject_unknown,
)

# The exhaustive job-position write whitelists of the route contract.
JOB_CREATE_FIELDS = ('name', 'department_id', 'no_of_recruitment', 'description')
JOB_PATCH_FIELDS = (*JOB_CREATE_FIELDS, 'active')


def dump_job(job, application_count, *, include_department=True):
    """One job position. ``application_count`` is LiwanOS's own count of the ongoing
    applicants of the company: the stock field is group-gated and misses applicants
    that were never linked to the job position.

    ``hr.department`` is guarded by ``hr.departments.read``, which recruitment does not
    depend on, so the department reference is only read for a caller who may read
    departments; the key stays present and is null otherwise (the same rule the employee
    serializer applies to its contract block)."""
    return {
        'id': job.id,
        'name': job.name,
        'department': ref(job.department_id) if include_department else None,
        'no_of_recruitment': job.no_of_recruitment,
        'application_count': application_count,
        'description': html2plaintext(job.description or '', include_references=False).strip(),
        'active': bool(job.active),
    }


def dump_stage(stage):
    return {
        'id': stage.id,
        'name': stage.name,
        'sequence': stage.sequence,
        'hired_stage': bool(stage.hired_stage),
        'fold': bool(stage.fold),
    }


def _positive_int(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ApiError(422, 'invalid', f'{field} must be a non-negative integer', field=field)
    return value


def parse_job_vals(payload, *, create):
    """Whitelist + coerce a job-position payload into ORM vals."""
    reject_unknown(payload, JOB_CREATE_FIELDS if create else JOB_PATCH_FIELDS)
    vals = {}
    if create or 'name' in payload:
        name = payload.get('name')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        vals['name'] = name.strip()
    if 'department_id' in payload:
        vals['department_id'] = optional_id(payload['department_id'], 'department_id')
    if 'no_of_recruitment' in payload:
        vals['no_of_recruitment'] = _positive_int(payload['no_of_recruitment'], 'no_of_recruitment')
    if 'description' in payload:
        vals['description'] = optional_text(payload['description'], 'description')
    if 'active' in payload:
        active = payload['active']
        if not isinstance(active, bool):
            raise ApiError(422, 'invalid', 'active must be a boolean', field='active')
        vals['active'] = active
    if not vals:
        raise ApiError(422, 'invalid', 'no fields to update')
    return vals
