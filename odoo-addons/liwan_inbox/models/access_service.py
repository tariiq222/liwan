# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

READ = 'inbox.conversations.read'
REPLY = 'inbox.conversations.reply'
ASSIGN = 'inbox.conversations.assign'
EXPORT = 'inbox.conversations.export'
MANAGE_CHANNELS = 'inbox.channels.manage'
MANAGE_SETTINGS = 'inbox.settings.manage'
MANAGE_TEMPLATES = 'inbox.templates.manage'
MANAGE_AUTOMATION = 'inbox.automation.manage'
# Its group also reads and writes rules and automatic messages (security/ir.model.access.csv): only so that publishing a
# copy can move them to it (liwan.inbox.flow._liwan_take_over). No route gives it more than that.
MANAGE_FLOWS = 'inbox.flows.manage'
REPORTS_READ = 'inbox.reports.read'
CAMPAIGNS = 'inbox.campaigns.manage'

PERMISSIONS = frozenset({
    READ, REPLY, ASSIGN, EXPORT, MANAGE_CHANNELS, MANAGE_SETTINGS, MANAGE_TEMPLATES, MANAGE_AUTOMATION, MANAGE_FLOWS, REPORTS_READ, CAMPAIGNS,
})
PERMISSION_DEPENDENCIES = {
    REPLY: {READ},
    ASSIGN: {READ},
    EXPORT: {READ},
}
# Vendor support runs the channels and the settings, and never reads the customers' conversations (owner decision 2026-10-29, INB-18).
VENDOR_SUPPORT_PERMISSIONS = frozenset({MANAGE_CHANNELS, MANAGE_SETTINGS})
# Customer messages are sensitive: the base employee role gets none of them.
ROLE_GRANTS = {
    'liwan_inbox.role_inbox_agent': frozenset({READ, REPLY}),
    'liwan_inbox.role_inbox_supervisor': frozenset({READ, REPLY, ASSIGN, EXPORT, REPORTS_READ}),
    'liwan_inbox.role_inbox_manager': PERMISSIONS,
    'liwan_core.role_vendor_support': VENDOR_SUPPORT_PERMISSIONS,
}


class LiwanInboxAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        # Support's foundation shortcut grants the whole catalog; the conversations are not part of what it runs.
        return keys - (PERMISSIONS - VENDOR_SUPPORT_PERMISSIONS) if user.has_group('liwan_core.group_vendor_support') else keys

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_inbox'} for key in sorted(PERMISSIONS)
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
        for role_xmlid, keys in ROLE_GRANTS.items():
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_inbox.group_inbox_manager'):
            keys |= PERMISSIONS
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'inbox_manager']
