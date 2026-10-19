# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError


def current_company():
    return request.env.company


def scoped_record(model, record_id, *, active_test=True):
    """A record of the current company → 404 otherwise.

    Another company's record is never a 403: the caller may not even know it exists.
    ``active_test=False`` also reaches archived records (a refused or archived applicant).
    """
    records = request.env[model] if active_test else request.env[model].with_context(active_test=False)
    record = records.search([
        ('id', '=', record_id),
        ('company_id', '=', current_company().id),
    ], limit=1)
    if not record:
        raise MissingError(request.env._('%(model)s %(id)s does not exist', model=model, id=record_id))
    record.check_access('read')
    return record


def company_relation(model, record_id, field):
    """A payload relation id that must be a record of the current company → 422 naming the field."""
    record = request.env[model].search([
        ('id', '=', record_id),
        ('company_id', '=', current_company().id),
    ], limit=1)
    if not record:
        raise ApiError(422, 'invalid', f'{field} does not reference a record of the current company', field=field)
    record.check_access('read')
    return record


def stage_of(record_id, job=None, field='stage_id'):
    """A recruitment stage: a global one, or one linked to ``job``; 422 otherwise."""
    stage = request.env['hr.recruitment.stage'].search([('id', '=', record_id)], limit=1)
    if not stage:
        raise ApiError(422, 'invalid', f'{field} does not reference an existing record', field=field)
    if job and stage.job_ids and job not in stage.job_ids:
        raise ApiError(422, 'invalid', f'{field} is not available for this job position', field=field)
    return stage
