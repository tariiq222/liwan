# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from .common import hr_rule_handler
from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
)
from odoo.addons.nasq_hr.serializers.hr_employee import (
    dump_employee,
    parse_access_grant,
    parse_access_patch,
    parse_employee_create,
    parse_employee_patch,
)

MAX_LIMIT = 200
EMPLOYEE_SCOPE_ERROR = 'employee is outside the current company'


def _is_admin():
    return request.env.user.has_group('nasq_core.group_customer_admin')


def _require_customer_admin():
    if not _is_admin():
        raise ApiError(403, 'forbidden', 'only a customer administrator can write this resource')


def _admin_employee(employee_id):
    employee = request.env['hr.employee'].with_context(active_test=False).browse(int(employee_id))
    if not employee.exists():
        raise MissingError(request.env._('hr.employee %(id)s does not exist', id=employee_id))
    if employee.company_id not in request.env.companies:
        raise AccessError(EMPLOYEE_SCOPE_ERROR)
    employee.check_access('read')
    return employee


def _public_employee(employee_id):
    employee = request.env['hr.employee.public'].search([
        ('id', '=', int(employee_id)),
        ('active', '=', True),
        ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not employee:
        raise MissingError(request.env._('hr.employee %(id)s does not exist', id=employee_id))
    return employee


def _relation(model, record_id, field):
    record = request.env[model].browse(int(record_id))
    try:
        if not record.exists():
            raise ApiError(422, 'invalid', f'{field} does not reference an existing record', field=field)
        if record.company_id not in request.env.companies:
            raise ApiError(422, 'invalid', f'{field} is outside the current company', field=field)
        record.check_access('read')
    except AccessError:
        raise ApiError(422, 'invalid', f'{field} is not available', field=field) from None
    return record


def _validate_employee_relations(vals, employee=None):
    if vals.get('department_id'):
        _relation('hr.department', vals['department_id'], 'department_id')
    if vals.get('parent_id'):
        if employee and vals['parent_id'] == employee.id:
            raise ApiError(422, 'invalid', 'an employee cannot manage themselves', field='parent_id')
        _relation('hr.employee', vals['parent_id'], 'parent_id')


class HrEmployeeController(http.Controller):

    @http.route('/api/v1/hr/employees', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_employees(self, **_):
        args = request.httprequest.args
        q = args.get('q')
        department_id = args.get('department_id')
        archived_param = args.get('archived')
        if archived_param not in (None, '0', 'false', '1', 'true'):
            raise ApiError(422, 'invalid', "archived must be '0', 'false', '1' or 'true'", field='archived')
        archived = archived_param in ('1', 'true')
        if archived and not _is_admin():
            raise ApiError(403, 'forbidden', 'only a customer administrator can list archived employees')
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = [('company_id', 'in', request.env.companies.ids)]
        if q:
            domain.append(('name', 'ilike', q))
        if department_id not in (None, ''):
            try:
                department_id = int(department_id)
            except (TypeError, ValueError):
                raise ApiError(422, 'invalid', 'department_id must be an integer', field='department_id') from None
            if department_id <= 0:
                raise ApiError(422, 'invalid', 'department_id must be a positive integer', field='department_id')
            domain.append(('department_id', '=', department_id))
        if archived:
            Employee = request.env['hr.employee'].with_context(active_test=False)
            domain.append(('active', '=', False))
        elif _is_admin():
            Employee = request.env['hr.employee']
        else:
            Employee = request.env['hr.employee.public']
        recs = Employee.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': [dump_employee(employee) for employee in recs], 'total': Employee.search_count(domain)}

    @http.route('/api/v1/hr/employees/<int:employee_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_employee(self, employee_id):
        employee = _admin_employee(employee_id) if _is_admin() else _public_employee(employee_id)
        return dump_employee(employee)

    @http.route('/api/v1/hr/employees', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    def create_employee(self, **payload):
        _require_customer_admin()
        vals = parse_employee_create(payload)
        _validate_employee_relations(vals)
        employee = request.env['hr.employee']._nasq_create(vals)
        return request.make_json_response(dump_employee(employee), status=201)

    @http.route('/api/v1/hr/employees/<int:employee_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @hr_rule_handler
    def patch_employee(self, employee_id, **payload):
        _require_customer_admin()
        employee = _admin_employee(employee_id)
        payload.pop('employee_id', None)
        if not payload:
            raise ApiError(422, 'invalid', 'no fields to update')
        vals = parse_employee_patch(payload)
        _validate_employee_relations(vals, employee)
        employee._nasq_write(vals)
        return dump_employee(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    def archive_employee(self, employee_id, **_):
        _require_customer_admin()
        employee = _admin_employee(employee_id)
        employee._nasq_archive()
        return dump_employee(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    def unarchive_employee(self, employee_id, **_):
        _require_customer_admin()
        employee = _admin_employee(employee_id)
        employee._nasq_unarchive()
        return dump_employee(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/access', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    def grant_employee_access(self, employee_id, **payload):
        _require_customer_admin()
        employee = _admin_employee(employee_id)
        values = parse_access_grant(payload)
        employee._nasq_grant_access(values['password'], values['role'])
        return dump_employee(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/access', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @hr_rule_handler
    def patch_employee_access(self, employee_id, **payload):
        _require_customer_admin()
        employee = _admin_employee(employee_id)
        values = parse_access_patch(payload)
        employee._nasq_update_access(**values)
        return dump_employee(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/access', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @hr_rule_handler
    def revoke_employee_access(self, employee_id, **_):
        _require_customer_admin()
        employee = _admin_employee(employee_id)
        employee._nasq_revoke_access()
        return dump_employee(employee)
