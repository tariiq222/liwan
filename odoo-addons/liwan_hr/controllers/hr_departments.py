# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from .common import hr_rule_handler
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.hr_department import (
    dump_department,
    dump_departments,
    parse_department_vals,
)

MAX_LIMIT = 200


def _can(capability):
    return request.env['liwan.access.service']._liwan_has_capability(request.env.user, capability)


def _require(capability):
    require_capabilities(capability)


def _admin_department(department_id):
    department = request.env['hr.department'].with_context(active_test=False).search([
        ('id', '=', int(department_id)),
        ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not department:
        raise MissingError(request.env._('hr.department %(id)s does not exist', id=department_id))
    department.check_access('read')
    return department


def _relation(model, record_id, field):
    record = request.env[model].browse(int(record_id))
    if not record.exists():
        raise MissingError(request.env._('%(model)s %(id)s does not exist', model=model, id=record_id))
    if record.company_id not in request.env.companies:
        raise AccessError('%s is outside the current company' % field)
    record.check_access('read')
    return record


def _validate_relations(vals):
    if vals.get('parent_id'):
        _relation('hr.department', vals['parent_id'], 'parent_id')
    if vals.get('manager_id'):
        _relation('hr.employee', vals['manager_id'], 'manager_id')


class HrDepartmentController(http.Controller):

    @http.route('/api/v1/hr/departments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_departments(self, **_):
        _require('hr.departments.read')
        args = request.httprequest.args
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        Department = request.env['hr.department']
        domain = [('company_id', 'in', request.env.companies.ids)]
        recs = Department.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': dump_departments(recs), 'total': Department.search_count(domain)}

    @http.route('/api/v1/hr/departments/<int:department_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_department(self, department_id):
        _require('hr.departments.read')
        department = request.env['hr.department'].search([
            ('id', '=', int(department_id)),
            ('company_id', 'in', request.env.companies.ids),
        ], limit=1)
        if not department:
            raise MissingError(request.env._('hr.department %(id)s does not exist', id=department_id))
        department.check_access('read')
        return dump_department(department)

    @http.route('/api/v1/hr/departments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def create_department(self, **payload):
        _require('hr.departments.manage')
        if 'name' not in payload:
            raise ApiError(422, 'invalid', 'name is required', field='name')
        vals = parse_department_vals(payload)
        _validate_relations(vals)
        department = request.env['hr.department']._liwan_create(vals)
        return request.make_json_response(dump_department(department), status=201)

    @http.route('/api/v1/hr/departments/<int:department_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def patch_department(self, department_id, **payload):
        _require('hr.departments.manage')
        department = _admin_department(department_id)
        payload.pop('department_id', None)
        if not payload:
            raise ApiError(422, 'invalid', 'no fields to update')
        vals = parse_department_vals(payload)
        _validate_relations(vals)
        department._liwan_write(vals)
        return dump_department(department)

    @http.route('/api/v1/hr/departments/<int:department_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def delete_department(self, department_id, **_):
        _require('hr.departments.manage')
        department = _admin_department(department_id)
        department._liwan_delete()
        return request.make_json_response('', status=204)
