# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import request

from .common import (
    active_employee,
    company_category,
    company_employee,
    current_company,
    own_employee,
    reject_own_custody,
    scoped_equipment,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.assets.common import reject_unknown
from odoo.addons.webvue_hr.serializers.assets.equipment import (
    dump_equipment,
    dump_equipments,
    parse_archive,
    parse_assign,
    parse_equipment_vals,
)

ACTIVE_VALUES = ('true', 'false', 'all')
ASSIGNED_VALUES = ('true', 'false')


def _validate_equipment_relations(vals, company):
    if vals.get('category_id'):
        company_category(vals['category_id'], company=company)


class HrAssetsEquipmentController(http.Controller):

    @http.route('/api/v1/hr/assets/equipment', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='read')
    @requires_capability('hr.assets.read')
    def list_equipment(self, **_):
        args = request.httprequest.args
        assigned = args.get('assigned')
        if assigned not in (None, '', *ASSIGNED_VALUES):
            raise ApiError(422, 'invalid', "assigned must be 'true' or 'false'", field='assigned')
        active = args.get('active', 'true')
        if active not in ACTIVE_VALUES:
            raise ApiError(422, 'invalid', "active must be 'true', 'false' or 'all'", field='active')
        limit, offset = parse_page(args)
        domain = [('company_id', 'in', request.env.companies.ids)]
        q = args.get('q')
        if q:
            domain += ['|', ('name', 'ilike', q), ('serial_no', 'ilike', q)]
        category_id = args.get('category_id')
        if category_id not in (None, ''):
            category = company_category(parse_positive_int(category_id, 'category_id'))
            domain.append(('category_id', '=', category.id))
        employee_id = args.get('employee_id')
        if employee_id not in (None, ''):
            # The filter accepts an archived employee: offboarding reads the custody of an
            # employee who may already be archived; only the assignment requires an active one.
            employee = company_employee(parse_positive_int(employee_id, 'employee_id'))
            domain.append(('employee_id', '=', employee.id))
        if assigned == 'true':
            domain.append(('employee_id', '!=', False))
        elif assigned == 'false':
            domain.append(('employee_id', '=', False))
        Equipment = request.env['maintenance.equipment'].with_context(active_test=active == 'true')
        if active == 'false':
            domain.append(('active', '=', False))
        equipment = Equipment.search(domain, order='name, id', limit=limit, offset=offset)
        return {'items': dump_equipments(equipment), 'total': Equipment.search_count(domain)}

    @http.route('/api/v1/hr/assets/equipment/<int:equipment_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='read')
    @requires_capability('hr.assets.read')
    def get_equipment(self, equipment_id):
        return dump_equipment(scoped_equipment(equipment_id, active_test=False))

    @http.route('/api/v1/hr/assets/equipment', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='write')
    @requires_capability('hr.assets.manage')
    def create_equipment(self, **payload):
        vals = parse_equipment_vals(payload, create=True)
        _validate_equipment_relations(vals, current_company())
        equipment = request.env['maintenance.equipment'].create(vals)
        return request.make_json_response(dump_equipment(equipment), status=201)

    @http.route('/api/v1/hr/assets/equipment/<int:equipment_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='write')
    @requires_capability('hr.assets.manage')
    def patch_equipment(self, equipment_id, **payload):
        equipment = scoped_equipment(equipment_id, active_test=False)
        # json2 merges the route's path parameters into the payload; the id is not a field.
        payload.pop('equipment_id', None)
        vals = parse_equipment_vals(payload, create=False)
        _validate_equipment_relations(vals, equipment.company_id)
        equipment.write(vals)
        return dump_equipment(equipment)

    @http.route('/api/v1/hr/assets/equipment/<int:equipment_id>/assign', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='write')
    @requires_capability('hr.assets.manage')
    def assign_equipment(self, equipment_id, **payload):
        equipment = scoped_equipment(equipment_id, active_test=False)
        payload.pop('equipment_id', None)
        employee_id, vals = parse_assign(payload)
        employee = active_employee(employee_id)
        reject_own_custody(employee)
        if equipment.employee_id:
            raise ApiError(422, 'invalid', 'this asset is already assigned; return it first', field='employee_id')
        equipment.check_access('write')
        # The stock assignment: the engine clears the department and subscribes the assignee
        # (hr_maintenance), which is what /me reads through. It stamps the date only when
        # ``equipment_assign_to`` changes, which a re-assignment after a return does not, so the
        # date is written here.
        equipment.write({
            'equipment_assign_to': 'employee',
            'employee_id': employee.id,
            'assign_date': vals.get('assign_date') or fields.Date.context_today(equipment),
        })
        return dump_equipment(equipment)

    @http.route('/api/v1/hr/assets/equipment/<int:equipment_id>/return', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='write')
    @requires_capability('hr.assets.manage')
    def return_equipment(self, equipment_id, **payload):
        equipment = scoped_equipment(equipment_id, active_test=False)
        payload.pop('equipment_id', None)
        reject_unknown(payload, ())
        reject_own_custody(equipment.employee_id)
        if not equipment.employee_id:
            raise ApiError(422, 'invalid', 'this asset is not assigned; there is nothing to return')
        equipment.check_access('write')
        # The chatter tracking keeps the custody history; only the holder is cleared.
        equipment.write({'employee_id': False})
        return dump_equipment(equipment)

    @http.route('/api/v1/hr/assets/equipment/<int:equipment_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='write')
    @requires_capability('hr.assets.manage')
    def archive_equipment(self, equipment_id, **payload):
        equipment = scoped_equipment(equipment_id, active_test=False)
        payload.pop('equipment_id', None)
        vals = parse_archive(payload)
        equipment.check_access('write')
        # An archived asset leaves the custody check of the exit, so a held one must be returned first.
        if equipment.employee_id:
            raise ApiError(422, 'invalid', 'return the asset to the company before archiving it', field='employee_id')
        equipment.write({'active': False, **vals})
        return dump_equipment(equipment)

    @http.route('/api/v1/hr/assets/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.assets', operation='read')
    @requires_capability('hr.employees.read')
    def list_my_equipment(self, **_):
        """The caller's own custody: the stock follower rule grants the read, the company
        filter and the employee keep it to the caller's own assets. No elevated read."""
        employee = own_employee()
        if not employee:
            return {'items': [], 'total': 0}
        equipment = request.env['maintenance.equipment'].search([
            ('company_id', '=', current_company().id),
            ('employee_id', '=', employee.id),
        ], order='name, id')
        return {'items': dump_equipments(equipment), 'total': len(equipment)}
