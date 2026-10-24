# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from .common import hr_rule_handler, own_public_employee
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.hr_employee import (
    dump_employee,
    parse_employee_create,
    parse_employee_patch,
)

MAX_LIMIT = 200


def _can(capability, employee=None):
    return request.env['webvue.access.service']._webvue_has_capability(
        request.env.user, capability, record=employee,
    )


def _require(capability):
    require_capabilities(capability)


def _dump(employee):
    """Detail shape: the contract block needs management; the list shape never carries it."""
    return dump_employee(
        employee,
        include_access=_can('hr.employees.access_status.read', employee),
        include_contract=_can('hr.employees.manage', employee),
    )


def _admin_employee(employee_id):
    employee = request.env['hr.employee'].with_context(active_test=False).search([
        ('id', '=', int(employee_id)),
        ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not employee:
        raise MissingError(request.env._('hr.employee %(id)s does not exist', id=employee_id))
    employee.check_access('read')
    return employee


def _public_employee(employee_id, *, include_archived=False):
    domain = [
        ('id', '=', int(employee_id)),
        ('company_id', 'in', request.env.companies.ids),
    ]
    if not include_archived:
        domain.append(('active', '=', True))
    employee = request.env['hr.employee.public'].with_context(active_test=False).search(domain, limit=1)
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


def _validate_contract_vals(vals, employee):
    if vals.get('contract_type_id') and not request.env['hr.contract.type'].browse(vals['contract_type_id']).exists():
        raise ApiError(
            422, 'invalid', 'contract.contract_type_id does not reference an existing record',
            field='contract.contract_type_id',
        )
    if 'contract_date_start' in vals or 'contract_date_end' in vals:
        start = vals.get('contract_date_start', employee.contract_date_start)
        end = vals.get('contract_date_end', employee.contract_date_end)
        if end and not start:
            raise ApiError(422, 'invalid', 'contract.end_date needs a start_date', field='contract.end_date')
        if start and end and end < start:
            raise ApiError(422, 'invalid', 'contract.end_date is before start_date', field='contract.end_date')


class HrEmployeeController(http.Controller):
    @http.route('/api/v1/hr/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def own_profile(self, **_):
        _require('hr.employees.read')
        employee = own_public_employee()
        return dump_employee(employee, include_access=False, include_contract=False) if employee else None

    @http.route('/api/v1/hr/employees', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_employees(self, **_):
        args = request.httprequest.args
        q = args.get('q')
        department_id = args.get('department_id')
        archived_param = args.get('archived')
        if archived_param not in (None, '0', 'false', '1', 'true'):
            raise ApiError(422, 'invalid', "archived must be '0', 'false', '1' or 'true'", field='archived')
        archived = archived_param in ('1', 'true')
        _require('hr.employees.read')
        if archived:
            _require('hr.employees.archive')
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
            Employee = request.env['hr.employee.public'].with_context(active_test=False)
            domain.append(('active', '=', False))
        else:
            Employee = request.env['hr.employee.public']
        recs = Employee.search(domain, order='name, id', limit=limit, offset=offset)
        return {
            'items': [
                dump_employee(
                    employee,
                    include_access=_can('hr.employees.access_status.read', employee),
                ) for employee in recs
            ],
            'total': Employee.search_count(domain),
        }

    @http.route('/api/v1/hr/employees/<int:employee_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_employee(self, employee_id):
        _require('hr.employees.read')
        # Deliberate: managing employees implies the full record, archived ones included
        # (_admin_employee searches with active_test=False); only the archived list needs archive.
        employee = _public_employee(employee_id, include_archived=True)
        privileged = any(_can(key, employee) for key in (
            'hr.employees.manage', 'hr.employees.archive', 'hr.employees.access_status.read',
        ))
        if _can('hr.employees.manage', employee):
            employee = _admin_employee(employee_id)
        elif not privileged and not employee.active:
            raise MissingError(request.env._('hr.employee %(id)s does not exist', id=employee_id))
        return _dump(employee)

    @http.route('/api/v1/hr/employees', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def create_employee(self, **payload):
        _require('hr.employees.manage')
        vals = parse_employee_create(payload)
        _validate_employee_relations(vals)
        employee = request.env['hr.employee']._webvue_create(vals)
        return request.make_json_response(
            _dump(employee),
            status=201,
        )

    @http.route('/api/v1/hr/employees/<int:employee_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def patch_employee(self, employee_id, **payload):
        _require('hr.employees.manage')
        employee = _admin_employee(employee_id)
        payload.pop('employee_id', None)
        if not payload:
            raise ApiError(422, 'invalid', 'no fields to update')
        vals = parse_employee_patch(payload)
        _validate_employee_relations(vals, employee)
        _validate_contract_vals(vals, employee)
        employee._webvue_write(vals)
        return _dump(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def archive_employee(self, employee_id, **_):
        _require('hr.employees.archive')
        employee = _admin_employee(employee_id)
        employee._webvue_archive()
        return _dump(employee)

    @http.route('/api/v1/hr/employees/<int:employee_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', operation='write')
    def unarchive_employee(self, employee_id, **_):
        _require('hr.employees.archive')
        employee = _admin_employee(employee_id)
        employee._webvue_unarchive()
        return _dump(employee)
