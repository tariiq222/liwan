# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.access_admin import (
    parse_assignments,
    parse_password,
    parse_query,
    require_exact,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    clear_security_caches_after_commit,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_api.serializers.access import dump_admin_user


class EmployeeAccountsController(http.Controller):

    @http.route('/api/v1/admin/employee-accounts/candidates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('access.users.grant')
    def candidates(self):
        filters, limit, offset = parse_query(
            {'q', 'department_id', 'employee_id', 'status', 'limit', 'offset'},
        )
        for key in ('department_id', 'employee_id'):
            if filters.get(key):
                filters[key] = parse_positive_int(filters[key], key)
        if filters.get('status') not in (None, 'active', 'archived'):
            raise ApiError(422, 'invalid', 'unknown status', field='status')
        return request.env['webvue.access.service']._webvue_employee_account_candidates(
            filters, limit, offset,
        )

    @http.route('/api/v1/admin/employee-accounts', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    @requires_capability('access.users.grant')
    def grant(self, **payload):
        require_exact(
            payload,
            {'employee_id', 'password', 'assignments'},
            {'employee_id', 'password', 'assignments'},
        )
        service = request.env['webvue.access.service']
        user = service._webvue_grant_employee_account(
            parse_positive_int(payload['employee_id'], 'employee_id'),
            parse_password(payload['password']),
            parse_assignments(payload['assignments']),
        )
        clear_security_caches_after_commit(request.env)
        extra = service._webvue_account_extra_fields(user.ids)
        return request.make_json_response(
            dump_admin_user(user, extra[user.id], detail=True), status=201,
        )
