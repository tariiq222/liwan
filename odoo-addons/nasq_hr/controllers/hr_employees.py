# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
)
from odoo.addons.nasq_hr.serializers.hr_employee import dump_employee

MAX_LIMIT = 200


class HrEmployeeController(http.Controller):

    @http.route('/api/v1/hr/employees', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_employees(self, **_):
        args = request.httprequest.args
        q = args.get('q')
        department_id = args.get('department_id')
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = []
        if q:
            domain.append(('name', 'ilike', q))
        if department_id not in (None, ''):
            try:
                domain.append(('department_id', '=', int(department_id)))
            except (TypeError, ValueError):
                raise ApiError(422, 'invalid', "department_id must be an integer", field='department_id') from None
        # Regular users read hr.employee.public; id is still the hr.employee id.
        Employee = request.env['hr.employee.public']
        recs = Employee.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': [dump_employee(e) for e in recs], 'total': Employee.search_count(domain)}

    @http.route('/api/v1/hr/employees/<int:employee_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_employee(self, employee_id):
        return dump_employee(get_record('hr.employee.public', employee_id))
