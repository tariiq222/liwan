# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

LEAVE_REQUEST = 'hr.leave.request'
OPERATIONS_REQUESTER = frozenset({'operations.requests.read', 'operations.requests.create'})


class HrOperationsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_permission_dependencies(self):
        """Filing a leave files its approval request, so the leave requester role holds the request permissions."""
        dependencies = super()._liwan_permission_dependencies()
        dependencies[LEAVE_REQUEST] = dependencies.get(LEAVE_REQUEST, set()) | OPERATIONS_REQUESTER
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        grants['liwan_hr.role_hr_manager'] = grants.get('liwan_hr.role_hr_manager', set()) | OPERATIONS_REQUESTER
        return grants
