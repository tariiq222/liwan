# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

AGENT_PERMISSIONS = frozenset({'crm.leads.read', 'crm.leads.work'})
PERMISSIONS = AGENT_PERMISSIONS | {
    'crm.leads.assign',
    'crm.leads.import',
    'crm.leads.export',
    'crm.discount.approve',
    'crm.settings.read',
    'crm.settings.manage',
    'crm.audit.read',
}
# Settings managers and importers always hold crm.leads.assign: a settings manager sees every opportunity
# of the company when judging stages, and an importer assigns the leads it distributes.
PERMISSION_DEPENDENCIES = {
    **{
        key: {'crm.leads.read'}
        for key in PERMISSIONS - {'crm.leads.read', 'crm.settings.read', 'crm.settings.manage', 'crm.leads.import'}
    },
    'crm.leads.import': {'crm.leads.read', 'crm.leads.assign'},
    'crm.settings.read': set(),
    'crm.settings.manage': {'crm.settings.read', 'crm.leads.assign'},
}


class LiwanCrmAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        # Support's foundation shortcut must not reach customer opportunities merely
        # because a new application registered its capabilities.
        return keys - PERMISSIONS if user.has_group('liwan_core.group_vendor_support') else keys

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_crm'} for key in sorted(PERMISSIONS)
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
            ('liwan_crm.role_crm_agent', AGENT_PERMISSIONS),
            ('liwan_crm.role_crm_manager', PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants
