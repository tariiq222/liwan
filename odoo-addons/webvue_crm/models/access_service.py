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
PERMISSION_DEPENDENCIES = {
    **{key: {'crm.leads.read'} for key in PERMISSIONS - {'crm.leads.read', 'crm.settings.read', 'crm.settings.manage'}},
    'crm.settings.read': set(),
    'crm.settings.manage': {'crm.settings.read'},
}


class WebVueCrmAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._webvue_capability_keys(user, company=company)
        # Support's foundation shortcut must not reach customer opportunities merely
        # because a new application registered its capabilities.
        return keys - PERMISSIONS if user.has_group('webvue_core.group_vendor_support') else keys

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_crm'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in (
            ('webvue_crm.role_crm_agent', AGENT_PERMISSIONS),
            ('webvue_crm.role_crm_manager', PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants
