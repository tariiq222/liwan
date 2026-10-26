# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/leave: the WebVue surface over stock hr_holidays.

Approval rules, balances, state changes and record visibility stay in
hr_holidays; this controller checks the WebVue capability, scopes queries to
authorized companies and validates relations against their selected owner.
"""
from odoo import http
from odoo.exceptions import MissingError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    require_capabilities,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.hr_leave import (
    dump_allocation,
    dump_balance,
    dump_leave,
    dump_leave_type,
    dump_settings,
    parse_allocation,
    parse_cancel_reason,
    parse_cancellation_action,
    parse_leave_request,
    parse_settings,
    parse_state_filter,
)

STAFF_CAPABILITIES = ('hr.leave.approve', 'hr.leave.manage')


def _can(capability, record=None):
    return request.env['webvue.access.service']._webvue_has_capability(
        request.env.user, capability, record=record,
    )


def _require(capability):
    require_capabilities(capability)


def _leave_visibility_domain():
    """Staff rights belong to each request's company, never another parent.

    The caller's own request follows their stored membership, like stock hr_holidays:
    a branch company is never in the staff projection (base.group_user is not added
    to a descendant), so an inherited branch owner would otherwise not see it.
    """
    service = request.env['webvue.access.service']
    staff_ids = set()
    for key in STAFF_CAPABILITIES:
        staff_ids.update(service._webvue_operation_capability_company_ids(key))
    memberships = service._webvue_membership_company_ids()
    return ((Domain('employee_id.user_id', '=', request.env.uid)
             & Domain('company_id', 'in', memberships))
            | (Domain('company_id', 'in', service._webvue_scoped_company_ids())
               & Domain('company_id', 'in', sorted(staff_ids))))


def _is_own(leave):
    return leave.employee_id in request.env.user.employee_ids


def _require_no_fields(payload):
    if payload:
        field = sorted(payload)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)


def _reject_self_decision(leave):
    """Segregation of duties: nobody decides their own request."""
    if _is_own(leave):
        raise ApiError(403, 'forbidden', 'a request cannot be approved or refused by its own requester')


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
        ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not employee:
        raise ApiError(422, 'invalid', 'employee_id is outside the current company', field='employee_id')
    return employee


def _target_employee(employee_id):
    """The caller's own employee, or another one when the caller manages leave."""
    if employee_id is None:
        return _own_employee()
    employee = _company_employee(employee_id)
    if not _can('hr.leave.manage', employee) and employee.user_id != request.env.user:
        raise ApiError(403, 'forbidden', 'hr.leave.manage capability is required')
    return employee


def _leave_types_domain(company=None):
    """The leave types hr_holidays offers this company: its own and shared ones, of its country or global."""
    company = company if company is not None else request.env.company
    return [
        ('company_id', 'in', [company.id, False]),
        ('country_id', 'in', [company.country_id.id, False] if company.country_id else [False]),
    ]


def _leave_type(leave_type_id, company):
    leave_type = request.env['hr.leave.type'].search(
        [('id', '=', leave_type_id), *_leave_types_domain(company)], limit=1,
    )
    if not leave_type:
        raise ApiError(422, 'invalid', 'leave_type_id is not available', field='leave_type_id')
    return leave_type


def _current_leave(leave_id):
    """A request of the current company; without approve/manage only the caller's own one.

    hr_holidays' record rules already hide other people's requests from an employee; the
    explicit employee filter keeps that guarantee in WebVue instead of in stock data.
    """
    domain = Domain('id', '=', int(leave_id)) & _leave_visibility_domain()
    leave = request.env['hr.leave'].search(domain, limit=1)
    if not leave:
        raise MissingError(request.env._('hr.leave %(id)s does not exist', id=leave_id))
    return leave


class HrLeaveController(http.Controller):

    @http.route('/api/v1/hr/leave/me/<int:leave_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_own_request(self, leave_id):
        _require('hr.leave.read')
        leave = request.env['hr.leave'].search([
            ('id', '=', leave_id),
            ('company_id', '=', request.env.company.id),
            ('employee_id.user_id', '=', request.env.uid),
        ], limit=1)
        if not leave:
            raise MissingError(request.env._('hr.leave %(id)s does not exist', id=leave_id))
        return dump_leave(leave)

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
        employee = _target_employee(employee_id)
        types = request.env['hr.leave.type'].search(
            [*_leave_types_domain(employee.company_id), ('requires_allocation', '=', True)], order='sequence, id',
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
        domain = list(_leave_visibility_domain())
        states = parse_state_filter(args.get('state'))
        if states:
            domain.append(('state', 'in', states))
        cancellation_state = args.get('cancellation_state')
        if cancellation_state not in (None, '', 'pending'):
            raise ApiError(422, 'invalid', 'cancellation_state must be pending', field='cancellation_state')
        if cancellation_state == 'pending':
            pending = request.env['webvue.hr.leave.cancellation'].search([('state', '=', 'pending')])
            domain.append(('id', 'in', pending.mapped('leave_id').ids))
        raw_employee = args.get('employee_id')
        if raw_employee not in (None, ''):
            domain.append(('employee_id', '=', parse_positive_int(raw_employee, 'employee_id')))
        if args.get('mine') == '1':
            domain.append(('employee_id.user_id', '=', request.env.uid))
        Leave = request.env['hr.leave']
        leaves = Leave.search(domain, order='request_date_from desc, id desc', limit=limit, offset=offset)
        cancellations = request.env['webvue.hr.leave.cancellation'].search([('leave_id', 'in', leaves.ids)])
        by_leave = {row.leave_id.id: row for row in cancellations}
        return {'items': [dump_leave(leave, by_leave.get(leave.id, False)) for leave in leaves], 'total': Leave.search_count(domain)}

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
        leave_type = _leave_type(vals['leave_type_id'], employee.company_id)
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
    def approve_request(self, leave_id, **payload):
        _require('hr.leave.approve')
        _require_no_fields(payload)
        leave = _current_leave(leave_id)
        _reject_self_decision(leave)
        leave.action_approve()
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/refuse', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def refuse_request(self, leave_id, reason=None, **payload):
        _require('hr.leave.approve')
        _require_no_fields(payload)
        reason = parse_cancel_reason(reason)
        leave = _current_leave(leave_id)
        _reject_self_decision(leave)
        leave.action_refuse()
        if reason:
            leave.message_post(body=reason)
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    @requires_capability('hr.leave.request', 'hr.leave.approve', match='any')
    def cancel_request(self, leave_id, **payload):
        vals = parse_cancellation_action(payload)
        leave = _current_leave(leave_id)
        reason = vals['reason']
        if leave.state == 'confirm':
            _require('hr.leave.request')
            if not _is_own(leave):
                raise ApiError(403, 'forbidden', 'only the requester can withdraw a request')
            leave.unlink()
            return {'id': leave_id, 'withdrawn': True}
        model = request.env['webvue.hr.leave.cancellation']
        if _is_own(leave):
            _require('hr.leave.request')
            pending = model.search([('leave_id', '=', leave.id), ('state', '=', 'pending')], limit=1)
            policy = request.env['webvue.hr.leave.settings']._webvue_effective_policy(leave.company_id)
            if pending or (leave.state == 'validate' and policy == 'manager_approval'):
                model.action_request(leave.id, reason)
            else:
                with model._webvue_owner_authorization(leave) as owned:
                    model._webvue_owner_leave(leave)
                    owned.env['hr.holidays.cancel.leave'].create({'leave_id': owned.id, 'reason': reason}).action_cancel_leave()
        else:
            _require('hr.leave.approve')
            model.action_direct_cancel(leave.id, reason, vals.get('revision'))
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/cancellation/approve', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    @requires_capability('hr.leave.approve')
    def approve_cancellation(self, leave_id, **payload):
        vals = parse_cancellation_action(payload, decision=True)
        leave = _current_leave(leave_id)
        row = request.env['webvue.hr.leave.cancellation'].search([('leave_id', '=', leave.id)], limit=1)
        if not row:
            raise ApiError(404, 'not_found', 'cancellation request does not exist')
        row.action_approve(vals['revision'], vals['reason'])
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/requests/<int:leave_id>/cancellation/refuse', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    @requires_capability('hr.leave.approve')
    def refuse_cancellation(self, leave_id, **payload):
        vals = parse_cancellation_action(payload, decision=True, refusal=True)
        leave = _current_leave(leave_id)
        row = request.env['webvue.hr.leave.cancellation'].search([('leave_id', '=', leave.id)], limit=1)
        if not row:
            raise ApiError(404, 'not_found', 'cancellation request does not exist')
        row.action_refuse(vals['revision'], vals['reason'])
        return dump_leave(leave)

    @http.route('/api/v1/hr/leave/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('hr.leave.config')
    def get_leave_settings(self, **_):
        return dump_settings(request.env['webvue.hr.leave.settings']._webvue_current())

    @http.route('/api/v1/hr/leave/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    @requires_capability('hr.leave.config')
    def patch_leave_settings(self, **payload):
        vals = parse_settings(payload)
        return dump_settings(request.env['webvue.hr.leave.settings'].action_save(**vals))

    @http.route('/api/v1/hr/leave/allocations', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    def create_allocation(self, **payload):
        """Grant days to another employee; the grant is approved at once.

        The manager's ``hr.leave.manage`` decision is the approval (owner decision
        2026-10-25, D-5 b), so the type's ``allocation_validation_type`` adds no
        second step here. Nobody grants days to their own employee record.
        """
        _require('hr.leave.manage')
        vals = parse_allocation(payload)
        employee = _company_employee(vals['employee_id'])
        if employee.user_id == request.env.user:
            raise ApiError(403, 'forbidden', 'an allocation cannot be granted by its own employee')
        if not _can('hr.leave.manage', employee):
            raise ApiError(403, 'forbidden', 'hr.leave.manage capability is required')
        leave_type = _leave_type(vals['leave_type_id'], employee.company_id)
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
