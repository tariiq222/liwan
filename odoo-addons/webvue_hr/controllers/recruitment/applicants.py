# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import can, company_relation, scoped_record, stage_of
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.recruitment.applicant import (
    dump_applicant,
    parse_applicant_create,
    parse_applicant_patch,
    parse_refuse,
    parse_status,
)
from odoo.addons.webvue_hr.serializers.recruitment.common import reject_unknown


def _dump(applicant):
    """The applicant shape with the department and employee references only for a caller
    who may read them: neither capability is implied by recruitment."""
    return dump_applicant(
        applicant,
        include_department=can('hr.departments.read', applicant),
        include_employee=can('hr.employees.read', applicant),
    )


def _applicants():
    """The applicant model with archived records reachable: a refusal archives the record."""
    return request.env['hr.applicant'].with_context(active_test=False)


def _filter_job(args):
    job_id = args.get('job_id')
    if job_id in (None, ''):
        return None
    return company_relation('hr.job', parse_positive_int(job_id, 'job_id'), 'job_id')


def _filter_stage(args, job):
    stage_id = args.get('stage_id')
    if stage_id in (None, ''):
        return None
    return stage_of(parse_positive_int(stage_id, 'stage_id'), job)


class HrRecruitmentApplicantController(http.Controller):

    @http.route('/api/v1/hr/recruitment/applicants', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='read')
    @requires_capability('hr.recruitment.read')
    def list_applicants(self, **_):
        args = request.httprequest.args
        domain = [('company_id', 'in', request.env.companies.ids)]
        q = args.get('q')
        if q:
            domain.append(('partner_name', 'ilike', q))
        job = _filter_job(args)
        if job:
            domain.append(('job_id', '=', job.id))
        stage = _filter_stage(args, job)
        if stage:
            domain.append(('stage_id', '=', stage.id))
        status = args.get('status')
        if status not in (None, ''):
            domain.extend(parse_status(status))
        limit, offset = parse_page(args)
        Applicant = _applicants()
        applicants = Applicant.search(domain, order='create_date desc, id desc', limit=limit, offset=offset)
        return {
            'items': [_dump(applicant) for applicant in applicants],
            'total': Applicant.search_count(domain),
        }

    @http.route('/api/v1/hr/recruitment/applicants/<int:applicant_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='read')
    @requires_capability('hr.recruitment.read')
    def get_applicant(self, applicant_id):
        return _dump(scoped_record('hr.applicant', applicant_id, active_test=False))

    @http.route('/api/v1/hr/recruitment/applicants', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage')
    def create_applicant(self, **payload):
        vals = parse_applicant_create(payload)
        job = company_relation('hr.job', vals['job_id'], 'job_id')
        vals['job_id'] = job.id
        # Preserve the selected job's owner, including an authorized branch. An explicit
        # value avoids stock's department read for recruiters without department access.
        vals['company_id'] = job.company_id.id
        applicant = request.env['hr.applicant'].create(vals)
        return request.make_json_response(_dump(applicant), status=201)

    @http.route('/api/v1/hr/recruitment/applicants/<int:applicant_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage')
    def patch_applicant(self, applicant_id, **payload):
        applicant = scoped_record('hr.applicant', applicant_id, active_test=False)
        payload.pop('applicant_id', None)
        vals = parse_applicant_patch(payload)
        if vals.get('stage_id'):
            vals['stage_id'] = stage_of(vals['stage_id'], applicant.job_id).id
        applicant.write(vals)
        return _dump(applicant)

    @http.route('/api/v1/hr/recruitment/applicants/<int:applicant_id>/refuse', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage')
    def refuse_applicant(self, applicant_id, **payload):
        applicant = scoped_record('hr.applicant', applicant_id, active_test=False)
        # json2 merges the route's path parameters into the payload; the id is not a field.
        payload.pop('applicant_id', None)
        reason_id = parse_refuse(payload)
        reason = request.env['hr.applicant.refuse.reason'].search([('id', '=', reason_id)], limit=1)
        if not reason:
            raise ApiError(422, 'invalid', 'refuse_reason_id does not reference an existing record', field='refuse_reason_id')
        applicant.check_access('write')
        # The stock wizard archives the applicant (active False) and records the reason;
        # no mail is sent from WebVue (`send_mail=False`).
        wizard = request.env['applicant.get.refuse.reason'].create({
            'applicant_ids': [(6, 0, applicant.ids)],
            'refuse_reason_id': reason.id,
            'send_mail': False,
        })
        wizard.action_refuse_reason_apply()
        return _dump(applicant)

    @http.route('/api/v1/hr/recruitment/applicants/<int:applicant_id>/reset', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage')
    def reset_applicant(self, applicant_id, **payload):
        applicant = scoped_record('hr.applicant', applicant_id, active_test=False)
        payload.pop('applicant_id', None)
        reject_unknown(payload, ())
        applicant.check_access('write')
        applicant.reset_applicant()
        return _dump(applicant)

    @http.route('/api/v1/hr/recruitment/applicants/<int:applicant_id>/hire', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage', 'hr.employees.manage')
    def hire_applicant(self, applicant_id, **payload):
        applicant = scoped_record('hr.applicant', applicant_id, active_test=False)
        payload.pop('applicant_id', None)
        reject_unknown(payload, ())
        if applicant.employee_id:
            raise ApiError(422, 'invalid', 'this applicant is already linked to an employee', field='employee_id')
        if applicant.refuse_reason_id:
            raise ApiError(422, 'invalid', 'a refused applicant cannot be hired', field='refuse_reason_id')
        applicant.check_access('write')
        # The stock conversion creates the hr.employee as the caller through the
        # WebVue-guarded model (which needs hr.employees.manage); the returned
        # act_window action is the Odoo web client's, not ours.
        applicant.create_employee_from_applicant()
        employee = applicant.employee_id
        if not employee:
            raise ApiError(422, 'invalid', 'the applicant was not linked to an employee', field='employee_id')
        return {'applicant': _dump(applicant), 'employee': {'id': employee.id, 'name': employee.name}}
