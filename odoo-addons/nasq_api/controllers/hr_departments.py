# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
)
from odoo.addons.nasq_api.serializers.hr_department import (
    dump_department,
    parse_department_vals,
)

MAX_LIMIT = 200


def _require_customer_admin():
    if not request.env.user.has_group('nasq_core.group_customer_admin'):
        raise ApiError(403, 'forbidden', "only a customer administrator can write this resource")


class HrDepartmentController(http.Controller):

    @http.route('/api/v1/hr/departments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_departments(self, **_):
        args = request.httprequest.args
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        Department = request.env['hr.department']
        domain = []
        recs = Department.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': [dump_department(d) for d in recs], 'total': Department.search_count(domain)}

    @http.route('/api/v1/hr/departments/<int:department_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_department(self, department_id):
        return dump_department(get_record('hr.department', department_id))

    @http.route('/api/v1/hr/departments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_department(self, name=None, parent_id=None, manager_id=None, **_):
        _require_customer_admin()
        payload = {'name': name}
        if parent_id is not None:
            payload['parent_id'] = parent_id
        if manager_id is not None:
            payload['manager_id'] = manager_id
        vals = parse_department_vals(payload)
        if vals.get('parent_id'):
            get_record('hr.department', vals['parent_id'])
        if vals.get('manager_id'):
            get_record('hr.employee.public', vals['manager_id'])
        dept = request.env['hr.department'].create(vals)
        return request.make_json_response(dump_department(dept), status=201)

    @http.route('/api/v1/hr/departments/<int:department_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_department(self, department_id, **payload):
        _require_customer_admin()
        payload.pop('department_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        dept = get_record('hr.department', department_id)
        vals = parse_department_vals(payload)
        if vals.get('parent_id'):
            get_record('hr.department', vals['parent_id'])
        if vals.get('manager_id'):
            get_record('hr.employee.public', vals['manager_id'])
        dept.write(vals)
        return dump_department(dept)
