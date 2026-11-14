# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

TENANT_EXPORT = 'tenant.export'
EXPORT_PATH = '/api/v1/admin/tenant-export'
EXPORT_MODELS = frozenset({'liwan.tenant.export', 'liwan.tenant.export.log'})


class LiwanTenantExportAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        # Support's foundation shortcut grants every registered key; a vendor never takes a tenant's data.
        return keys - {TENANT_EXPORT} if user.has_group('liwan_core.group_vendor_support') else keys

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + ({'key': TENANT_EXPORT, 'owner': 'liwan_api'},)

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        role = 'liwan_core.role_system_admin'
        grants[role] = grants.get(role, set()) | {TENANT_EXPORT}
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_access_admin'):
            keys |= {TENANT_EXPORT}
        return keys


class LiwanTenantExportEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_api_write_allowed(self, path):
        # Taking a copy of one's data is a read: it stays open while the tenant is read-only (unpaid or expired).
        return path == EXPORT_PATH or super()._liwan_api_write_allowed(path)

    @api.model
    def _liwan_read_only_allowances(self):
        # The export's own job row and log row are bookkeeping of a read; nothing else is writable for it.
        allowances = super()._liwan_read_only_allowances()
        return {**allowances, 'plumbing': allowances['plumbing'] | EXPORT_MODELS}
