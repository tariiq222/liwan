# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class HrOperationsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_builtin_role_grants(self):
        # The HR manager decides leave requests on their workflow page, which the operations application opens by read.
        grants = super()._liwan_builtin_role_grants()
        grants['liwan_hr.role_hr_manager'] = grants.get('liwan_hr.role_hr_manager', set()) | {'operations.requests.read'}
        return grants
