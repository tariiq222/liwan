# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.access_admin import require_exact
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)


class FinanceBranchStrictnessController(http.Controller):
    """«Stricter than the general policy» for finance: its roles are never inherited into branches."""

    @http.route('/api/v1/finance/branch-strictness', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    @requires_capability('finance.setup.read')
    def get_strictness(self, **_):
        return request.env['liwan.access.service']._liwan_branch_strict_state('finance')

    @http.route('/api/v1/finance/branch-strictness', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('finance.enabled', operation='write')
    @requires_capability('finance.setup.manage')
    def patch_strictness(self, **payload):
        require_exact(payload, {'enabled'}, {'enabled'})
        return request.env['liwan.access.service']._liwan_set_branch_strict('finance', payload['enabled'])
