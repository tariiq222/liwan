# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .access_admin import _target_user, parse_seat_options, require_exact
from .common import (
    api_handler,
    clear_security_caches_after_commit,
    requires_capability,
)


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

    @http.route('/api/v1/admin/branches', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_capability('settings.company.manage')
    def list_branches(self):
        entitlement = request.env['liwan.entitlement.service']
        entitlement._liwan_assert_branch_admin()
        branches = entitlement._liwan_branches()
        return {
            'items': [{
                'id': branch.company_id.id, 'name': branch.company_id.name, 'read_only': branch.read_only,
                'seat_choice': branch.seat_choice, 'restore_priority': branch.restore_priority,
            } for branch in branches],
            'total': len(branches),
            'limit': entitlement._liwan_limit_value('branches.extra_limit'),
            'read_only': entitlement._liwan_excess_counts()['branches.extra_limit'],
        }

    @http.route('/api/v1/admin/branches/<int:branch_id>/seat', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_capability('settings.company.manage')
    def update_branch_seat(self, branch_id, **payload):
        require_exact(payload, {'read_only', 'priority'})
        read_only, priority = parse_seat_options(payload)
        branch = request.env['liwan.entitlement.service']._liwan_set_branch_seat(branch_id, read_only, priority)
        return {
            'id': branch_id, 'name': branch.company_id.name, 'read_only': branch.read_only,
            'seat_choice': branch.seat_choice, 'restore_priority': branch.restore_priority,
        }

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
