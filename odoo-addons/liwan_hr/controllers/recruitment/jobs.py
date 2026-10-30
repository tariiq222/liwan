# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import can, company_relation, current_company, scoped_record
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.recruitment.common import ref
from odoo.addons.liwan_hr.serializers.recruitment.job import (
    dump_job,
    dump_stage,
    parse_job_vals,
)

ACTIVE_VALUES = ('true', 'false', 'all')


def _ongoing_applicants(job):
    """The number the job card shows: ongoing applicants of this company, counted by LiwanOS
    because the stock `application_count` is group-gated and ignores the company."""
    return request.env['hr.applicant'].search_count([
        ('job_id', '=', job.id),
        ('company_id', 'in', request.env.companies.ids),
        ('active', '=', True),
        ('date_closed', '=', False),
        ('refuse_reason_id', '=', False),
    ])


def _dump_job(job):
    """The job shape with the department reference only for a caller who may read departments."""
    return dump_job(
        job, _ongoing_applicants(job), include_department=can('hr.departments.read', job),
    )


def _validate_job_relations(vals, company):
    if vals.get('department_id'):
        company_relation('hr.department', vals['department_id'], 'department_id', company=company)


class HrRecruitmentJobController(http.Controller):

    @http.route('/api/v1/hr/recruitment/jobs', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='read')
    @requires_capability('hr.recruitment.read')
    def list_jobs(self, **_):
        args = request.httprequest.args
        active = args.get('active', 'true')
        if active not in ACTIVE_VALUES:
            raise ApiError(422, 'invalid', "active must be 'true', 'false' or 'all'", field='active')
        limit, offset = parse_page(args)
        domain = [('company_id', 'in', request.env.companies.ids)]
        q = args.get('q')
        if q:
            domain.append(('name', 'ilike', q))
        department_id = args.get('department_id')
        if department_id not in (None, ''):
            department = company_relation(
                'hr.department',
                parse_positive_int(department_id, 'department_id'),
                'department_id',
            )
            domain.append(('department_id', '=', department.id))
        Job = request.env['hr.job'].with_context(active_test=active == 'true')
        if active == 'false':
            domain.append(('active', '=', False))
        jobs = Job.search(domain, order='name, id', limit=limit, offset=offset)
        return {
            'items': [_dump_job(job) for job in jobs],
            'total': Job.search_count(domain),
        }

    @http.route('/api/v1/hr/recruitment/jobs/<int:job_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='read')
    @requires_capability('hr.recruitment.read')
    def get_job(self, job_id):
        job = scoped_record('hr.job', job_id, active_test=False)
        return _dump_job(job)

    @http.route('/api/v1/hr/recruitment/jobs', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage')
    def create_job(self, **payload):
        vals = parse_job_vals(payload, create=True)
        _validate_job_relations(vals, current_company())
        job = request.env['hr.job'].create(vals)
        return request.make_json_response(dump_job(job, 0, include_department=can('hr.departments.read', job)), status=201)

    @http.route('/api/v1/hr/recruitment/jobs/<int:job_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='write')
    @requires_capability('hr.recruitment.manage')
    def patch_job(self, job_id, **payload):
        job = scoped_record('hr.job', job_id, active_test=False)
        payload.pop('job_id', None)
        vals = parse_job_vals(payload, create=False)
        _validate_job_relations(vals, job.company_id)
        job.write(vals)
        return _dump_job(job)

    @http.route('/api/v1/hr/recruitment/stages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='read')
    @requires_capability('hr.recruitment.read')
    def list_stages(self, **_):
        args = request.httprequest.args
        domain = []
        job_id = args.get('job_id')
        if job_id not in (None, ''):
            job = company_relation('hr.job', parse_positive_int(job_id, 'job_id'), 'job_id')
            domain = ['|', ('job_ids', '=', False), ('job_ids', '=', job.id)]
        stages = request.env['hr.recruitment.stage'].search(domain, order='sequence, id')
        return {'items': [dump_stage(stage) for stage in stages], 'total': len(stages)}

    @http.route('/api/v1/hr/recruitment/refuse-reasons', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.recruitment', operation='read')
    @requires_capability('hr.recruitment.read')
    def list_refuse_reasons(self, **_):
        reasons = request.env['hr.applicant.refuse.reason'].search([], order='sequence, id')
        return {'items': [ref(reason) for reason in reasons], 'total': len(reasons)}
