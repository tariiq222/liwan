# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/leave: the WebVue surface over stock hr_holidays.

Approval rules, balances, state changes and record visibility stay in
hr_holidays; this controller only checks the WebVue capability, scopes every
query to the current company and serializes a whitelisted shape.
"""
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.hr_leave import (
    dump_allocation,
    dump_balance,
    dump_leave,
    dump_leave_type,
    parse_allocation,
    parse_leave_request,
    parse_state_filter,
)

STAFF_CAPABILITIES = ('hr.leave.approve', 'hr.leave.manage')


def _can(capability):
    return request.env['webvue.access.service']._webvue_has_capability(request.env.user, capability)


def _require(capability):
    if not _can(capability):
        raise ApiError(403, 'forbidden', f'{capability} capability is required')


def _is_staff():
    return any(_can(capability) for capability in STAFF_CAPABILITIES)


def _own_employee():
    employee = request.env.user.employee_ids.filtered(
        lambda record: record.company_id == request.env.company,
    )[:1]
    if not employee:
        raise ApiError(422, 'invalid', 'the current user has no employee record in this company')
    return employee


def _company_employee(employee_id):
    employee = request.env['hr.employee'].search([
        ('id', '=', employee_id),
        ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not employee:
        raise ApiError(422, 'invalid', 'employee_id is outside the current company', field='employee_id')
    return employee


def _target_employee(employee_id):
    """The caller's own employee, or another one when the caller manages leave."""
    if employee_id is None:
        return _own_employee()
    if not _can('hr.leave.manage'):
        own = _own_employee()
        if own.id != employee_id:
            raise ApiError(403, 'forbidden', 'hr.leave.manage capability is required')
        return own
    return _company_employee(employee_id)


def _leave_types_domain():
    """The leave types hr_holidays offers this company: its own and shared ones, of its country or global."""
    company = request.env.company
    return [
        ('company_id', 'in', [company.id, False]),
        ('country_id', 'in', [company.country_id.id, False] if company.country_id else [False]),
    ]


def _leave_type(leave_type_id):
    leave_type = request.env['hr.leave.type'].search(
        [('id', '=', leave_type_id), *_leave_types_domain()], limit=1,
    )
    if not leave_type:
        raise ApiError(422, 'invalid', 'leave_type_id is not available', field='leave_type_id')
    return leave_type


def _current_leave(leave_id):
    """A request of the current company; without approve/manage only the caller's own one.

    hr_holidays' record rules already hide other people's requests from an employee; the
    explicit employee filter keeps that guarantee in WebVue instead of in stock data.
    """
    domain = [('id', '=', int(leave_id)), ('company_id', '=', request.env.company.id)]
    if not _is_staff():
        domain.append(('employee_id.user_id', '=', request.env.user.id))
    leave = request.env['hr.leave'].search(domain, limit=1)
    if not leave:
        raise MissingError(request.env._('hr.leave %(id)s does not exist', id=leave_id))
    return leave


class HrLeaveController(http.Controller):

    @http.route('/api/v1/hr/leave/types', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_leave_types(self, **_):
        _require('hr.leave.read')
        types = request.env['hr.leave.type'].search(_leave_types_domain(), order='sequence, id')
        return {'items': [dump_leave_type(t) for t in types], 'total': len(types)}

    @http.route('/api/v1/hr/leave/balances', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_balances(self, **_):
        _require('hr.leave.read')
        raw = request.httprequest.args.get('employee_id')
        employee_id = parse_positive_int(raw, 'employee_id') if raw not in (None, '') else None
        if employee_id is None:
            employee = _own_employee()
        elif _is_staff():
            employee = _company_employee(employee_id)
        else:
            employee = _target_employee(employee_id)
        types = request.env['hr.leave.type'].search(
            [*_leave_types_domain(), ('requires_allocation', '=', True)], order='sequence, id',
        )
        # Like hr_holidays' own dashboard, only the types the employee holds a balance in.
        data = types.get_allocation_data(employee)[employee]
        items = [
            dump_balance(type_id, name, values)
            for name, values, _requires, type_id in data if values['max_leaves']
        ]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/hr/leave/requests', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_requests(self, **_):
        _require('hr.leave.read')
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', '=', request.env.company.id)]
        state = parse_state_filter(args.get('state'))
        if state:
            domain.append(('state', '=', state))
        raw_employee = args.get('employee_id')
        if raw_employee not in (None, ''):
            domain.append(('employee_id', '=', parse_positive_int(raw_employee, 'employee_id')))
        if not _is_staff() or args.get('mine') == '1':
            domain.append(('employee_id', '=', _own_employee().id))
        Leave = request.env['hr.leave']
        leaves = Leave.search(domain, order='request_date_from desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_leave(leave) for leave in leaves], 'total': Leave.search_count(domain)}

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_request(self, leave_id):
        _require('hr.leave.read')
        return dump_leave(_current_leave(leave_id))

    @http.route('/api/v1/hr/leave/requests', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def create_request(self, **payload):
        _require('hr.leave.request')
        vals = parse_leave_request(payload)
        employee = _target_employee(vals['employee_id'])
        leave_type = _leave_type(vals['leave_type_id'])
        leave = request.env['hr.leave'].create({
            'employee_id': employee.id,
            'holiday_status_id': leave_type.id,
            'request_date_from': vals['date_from'],
            'request_date_to': vals['date_to'],
            'notes': vals['notes'],
        })
        return request.make_json_response(dump_leave(leave), status=201)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/approve', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def approve_request(self, leave_id, **_):
        _require('hr.leave.approve')
        leave = _current_leave(leave_id)
        leave.action_approve()
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/refuse', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def refuse_request(self, leave_id, **_):
        _require('hr.leave.approve')
        leave = _current_leave(leave_id)
        leave.action_refuse()
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def cancel_request(self, leave_id, reason=None, **_):
        _require('hr.leave.request')
        if reason is not None and not isinstance(reason, str):
            raise ApiError(422, 'invalid', 'reason must be a string', field='reason')
        leave = _current_leave(leave_id)
        if not leave.can_cancel:
            raise ApiError(422, 'invalid', 'this leave cannot be cancelled')
        request.env['hr.holidays.cancel.leave'].create({
            'leave_id': leave.id, 'reason': (reason or '').strip(),
        }).action_cancel_leave()
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/allocations', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def create_allocation(self, **payload):
        _require('hr.leave.manage')
        vals = parse_allocation(payload)
        employee = _company_employee(vals['employee_id'])
        leave_type = _leave_type(vals['leave_type_id'])
        if not leave_type.requires_allocation:
            raise ApiError(422, 'invalid', 'this leave type does not use allocations', field='leave_type_id')
        allocation = request.env['hr.leave.allocation'].create({
            'employee_id': employee.id,
            'holiday_status_id': leave_type.id,
            'number_of_days': vals['number_of_days'],
            'date_from': vals['date_from'],
            'date_to': vals['date_to'] or False,
            'notes': vals['notes'],
        })
        if allocation.state != 'validate':
            allocation.action_approve()
        return request.make_json_response(dump_allocation(allocation), status=201)
