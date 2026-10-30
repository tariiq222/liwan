# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .access_admin import _target_user, require_exact
from .common import api_handler, clear_security_caches_after_commit, requires_capability


class AccessBranchesController(http.Controller):
    @http.route('/api/v1/admin/access/branches', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('access.users.assign_roles', 'access.roles.read')
    def policy(self):
        return request.env['liwan.access.service']._liwan_branch_policy()

    @http.route('/api/v1/admin/access/branches', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_capability('access.users.assign_roles', 'access.roles.read')
    def update_policy(self, **payload):
        require_exact(payload, {'expected_version', 'mode', 'branches'}, {'expected_version', 'mode', 'branches'})
        result = request.env['liwan.access.service']._liwan_update_branch_policy(
            payload['expected_version'], payload['mode'], payload['branches'],
        )
        clear_security_caches_after_commit(request.env)
        return result

    @http.route('/api/v1/admin/branches', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_capability('settings.company.manage')
    def create_branch(self, **payload):
        require_exact(payload, {'name'}, {'name'})
        company = request.env['liwan.entitlement.service']._liwan_create_branch(payload['name'])
        clear_security_caches_after_commit(request.env)
        return {'id': company.id, 'name': company.name}

    @http.route('/api/v1/admin/access/branches/preset', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_capability('access.users.assign_roles', 'access.roles.read')
    def apply_preset(self, **payload):
        require_exact(payload, {'expected_version', 'preset'}, {'expected_version', 'preset'})
        result = request.env['liwan.access.service']._liwan_apply_branch_preset(
            payload['expected_version'], payload['preset'],
        )
        clear_security_caches_after_commit(request.env)
        return result

    @http.route('/api/v1/admin/users/<int:user_id>/branches', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('access.users.assign_roles', 'access.roles.read')
    def user_branches(self, user_id):
        return request.env['liwan.access.service']._liwan_user_branch_access(_target_user(user_id))

    @http.route('/api/v1/admin/users/<int:user_id>/branches', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_capability('access.users.assign_roles', 'access.roles.read')
    def update_user_branches(self, user_id, **payload):
        require_exact(payload, {'expected_version', 'branches'}, {'expected_version', 'branches'})
        result = request.env['liwan.access.service']._liwan_update_user_branch_access(
            _target_user(user_id), payload['expected_version'], payload['branches'],
        )
        clear_security_caches_after_commit(request.env)
        return result
