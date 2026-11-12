# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .access_admin import require_exact
from .common import (
    api_handler,
    clear_security_caches_after_commit,
    requires_capability,
)


class AccessPolicyController(http.Controller):
    @http.route('/api/v1/admin/access/policy', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('access.roles.read')
    def policy(self):
        return request.env['liwan.access.service']._liwan_access_policy()

    @http.route('/api/v1/admin/access/policy', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_capability('access.users.assign_roles', 'settings.company.manage')
    def update_policy(self, **payload):
        require_exact(payload, {'self_grant', 'expected_version'}, {'self_grant', 'expected_version'})
        result = request.env['liwan.access.service']._liwan_set_self_grant_policy(
            payload['expected_version'], payload['self_grant'],
        )
        clear_security_caches_after_commit(request.env)
        return result
