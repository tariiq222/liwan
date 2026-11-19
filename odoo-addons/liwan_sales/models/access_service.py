# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

READ = 'sales.read'
QUOTATIONS_MANAGE = 'sales.quotations.manage'
ORDERS_CONFIRM = 'sales.orders.confirm'
DISCOUNTS_APPROVE = 'sales.discounts.approve'
DOCUMENTS_ASSIGN = 'sales.documents.assign'
REPORTS_READ = 'sales.reports.read'
SETTINGS_MANAGE = 'sales.settings.manage'

AGENT_PERMISSIONS = frozenset({READ, QUOTATIONS_MANAGE, ORDERS_CONFIRM})
PERMISSIONS = AGENT_PERMISSIONS | {DISCOUNTS_APPROVE, DOCUMENTS_ASSIGN, REPORTS_READ, SETTINGS_MANAGE}
PERMISSION_DEPENDENCIES = {
    key: {READ} for key in (QUOTATIONS_MANAGE, ORDERS_CONFIRM, DISCOUNTS_APPROVE, DOCUMENTS_ASSIGN, REPORTS_READ)
}


class LiwanSalesAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_sales'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid, keys in (
            ('liwan_sales.role_sales_agent', AGENT_PERMISSIONS),
            ('liwan_sales.role_sales_manager', PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants
