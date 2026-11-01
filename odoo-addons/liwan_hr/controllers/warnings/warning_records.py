# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/warnings: administrative warnings (HR warnings capabilities, the issuing manager, the employee).

A warning is disciplinary data: the routes below read it only through the caller's record rules, and the
employee's own routes (`/me`) return nothing but the caller's own issued warnings. Issuing is checked by the
model (`_liwan_can_issue`): HR, or the direct manager when the company's policy allows it, never for the
caller's own employee record.
"""
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    declare_read_capability_scope,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.assets.common import ref
from odoo.addons.liwan_hr.serializers.warnings.warning import (
    dump_standing,
    dump_warning,
    parse_contest,
    parse_create,
    parse_revision_only,
    parse_state_filter,
    parse_withdraw,
)

WARNING = 'liwan.hr.warning'
FORBIDDEN = 'you may not do this to this warning'


def _warning(warning_id):
    """A warning of the pinned companies the caller's record rules show → 404 otherwise (never a 403)."""
    warning = request.env[WARNING].search([
        ('id', '=', int(warning_id)), ('company_id', 'in', request.env.companies.ids),
        *_not_a_draft_about_the_caller(),
    ], limit=1)
    if not warning:
        raise MissingError(request.env._('liwan.hr.warning %(id)s does not exist', id=warning_id))
    return warning


def _not_a_draft_about_the_caller():
    """A subject never reads a warning about themself before it is issued, whatever else they hold."""
    return ['|', ('employee_user_id', '!=', request.env.uid), ('issued_at', '!=', False)]


def _own_warning(warning_id):
    """A warning issued to the caller's own employee record in the current company → 404 otherwise."""
    warning = request.env[WARNING].search([
        ('id', '=', int(warning_id)),
        ('employee_user_id', '=', request.env.uid),
        ('company_id', '=', request.env.company.id),
        ('issued_at', '!=', False),
    ], limit=1)
    if not warning:
        raise MissingError(request.env._('liwan.hr.warning %(id)s does not exist', id=warning_id))
    return warning


def _employee(employee_id, field='employee_id'):
    """An active employee of the pinned companies the caller may read → 422 naming the field."""
    employee = request.env['hr.employee'].search([
        ('id', '=', employee_id), ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not employee:
        raise ApiError(422, 'invalid', f'{field} does not reference an employee of the current company', field=field)
    return employee


def _list(domain, args):
    limit, offset = parse_page(args)
    state = parse_state_filter(args.get('state'))
    if state:
        domain = [*domain, ('state', '=', state)]
    Warning = request.env[WARNING]
    rows = Warning.search(domain, limit=limit, offset=offset)
    return {'items': [dump_warning(row) for row in rows], 'total': Warning.search_count(domain)}


class HrWarningController(http.Controller):

    @http.route('/api/v1/hr/warnings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    @requires_capability('hr.warnings.read')
    def list_warnings(self, **_):
        args = request.httprequest.args
        domain = [('company_id', 'in', request.env.companies.ids)]
        if args.get('employee_id'):
            domain.append(('employee_id', '=', parse_positive_int(args['employee_id'], 'employee_id')))
        if args.get('type_id'):
            domain.append(('type_id', '=', parse_positive_int(args['type_id'], 'type_id')))
        return _list(domain, args)

    @http.route('/api/v1/hr/warnings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    def create_warning(self, **payload):
        vals = parse_create(payload)
        request.env['liwan.hr.warning.type']._liwan_ensure_for_caller()
        employee = _employee(vals['employee_id'])
        if not request.env[WARNING]._liwan_can_issue(employee):
            raise ApiError(403, 'forbidden', 'you may not issue a warning to this employee')
        warning = request.env[WARNING].action_create(vals)
        return request.make_json_response(dump_warning(warning), status=201)

    # The caller's own warnings come before the id routes; `me` is not an id, so the order is for the reader.
    @http.route('/api/v1/hr/warnings/candidates', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    def list_candidates(self, **_):
        if not request.env[WARNING]._liwan_can_issue_any(request.env.company):
            raise ApiError(403, 'forbidden', 'you may not issue warnings')
        request.env['liwan.hr.warning.type']._liwan_ensure_for_caller()
        employees = request.env[WARNING]._liwan_candidates(request.env.company)
        return {'items': [ref(employee) for employee in employees], 'total': len(employees)}

    @http.route('/api/v1/hr/warnings/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    @requires_capability('hr.employees.read')
    def list_own_warnings(self, **_):
        domain = [
            ('employee_user_id', '=', request.env.uid), ('company_id', '=', request.env.company.id),
            ('issued_at', '!=', False),
        ]
        return _list(domain, request.httprequest.args)

    @http.route('/api/v1/hr/warnings/me/<int:warning_id>/acknowledge', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    @requires_capability('hr.employees.read')
    def acknowledge_warning(self, warning_id, **payload):
        revision = parse_revision_only(payload)
        return dump_warning(_own_warning(warning_id).action_acknowledge(revision))

    @http.route('/api/v1/hr/warnings/me/<int:warning_id>/contest', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    @requires_capability('hr.employees.read')
    def contest_warning(self, warning_id, **payload):
        revision, note = parse_contest(payload)
        return dump_warning(_own_warning(warning_id).action_contest(revision, note))

    @http.route('/api/v1/hr/warnings/standing/<int:employee_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    def get_standing(self, employee_id, **_):
        employee = request.env['hr.employee'].search([
            ('id', '=', employee_id), ('company_id', 'in', request.env.companies.ids),
        ], limit=1)
        if not employee:
            raise MissingError(request.env._('hr.employee %(id)s does not exist', id=employee_id))
        if not request.env[WARNING]._liwan_can_read_standing(employee):
            raise ApiError(403, 'forbidden', 'you may not read the warning standing of this employee')
        return dump_standing(request.env[WARNING]._liwan_standing(employee))

    @http.route('/api/v1/hr/warnings/<int:warning_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='read')
    def get_warning(self, warning_id, **_):
        # Readers see their companies; a manager sees what he drafted. The record rules decide the rows.
        declare_read_capability_scope('hr.warnings.read')
        warning = _warning(warning_id)
        if not warning._liwan_can_read_detail():
            raise ApiError(403, 'forbidden', FORBIDDEN)
        return dump_warning(warning)

    @http.route('/api/v1/hr/warnings/<int:warning_id>/issue', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    def issue_warning(self, warning_id, **payload):
        revision = parse_revision_only(payload)
        warning = _warning(warning_id)
        if not warning._liwan_can_manage():
            raise ApiError(403, 'forbidden', FORBIDDEN)
        return dump_warning(warning.action_issue(revision))

    @http.route('/api/v1/hr/warnings/<int:warning_id>/withdraw', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.warnings', operation='write')
    def withdraw_warning(self, warning_id, **payload):
        revision, reason = parse_withdraw(payload)
        warning = _warning(warning_id)
        if not warning._liwan_can_withdraw():
            raise ApiError(403, 'forbidden', FORBIDDEN)
        return dump_warning(warning.action_withdraw(revision, reason))
