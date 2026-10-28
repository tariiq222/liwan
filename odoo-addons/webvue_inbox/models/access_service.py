# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

READ = 'inbox.conversations.read'
REPLY = 'inbox.conversations.reply'
ASSIGN = 'inbox.conversations.assign'
EXPORT = 'inbox.conversations.export'
MANAGE_CHANNELS = 'inbox.channels.manage'
MANAGE_SETTINGS = 'inbox.settings.manage'

PERMISSIONS = frozenset({READ, REPLY, ASSIGN, EXPORT, MANAGE_CHANNELS, MANAGE_SETTINGS})
PERMISSION_DEPENDENCIES = {
    REPLY: {READ},
    ASSIGN: {READ},
    EXPORT: {READ},
}
# Customer messages are sensitive: the base employee role gets none of them.
ROLE_GRANTS = {
    'webvue_inbox.role_inbox_agent': frozenset({READ, REPLY}),
    'webvue_inbox.role_inbox_supervisor': frozenset({READ, REPLY, ASSIGN, EXPORT}),
    'webvue_inbox.role_inbox_manager': PERMISSIONS,
    'webvue_core.role_vendor_support': PERMISSIONS,
}


class WebVueInboxAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_inbox'} for key in sorted(PERMISSIONS)
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
        for role_xmlid, keys in ROLE_GRANTS.items():
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_inbox.group_inbox_manager'):
            keys |= PERMISSIONS
        return keys

    @api.model
    def _webvue_legacy_admin_roles(self):
        return [*super()._webvue_legacy_admin_roles(), 'inbox_manager']
