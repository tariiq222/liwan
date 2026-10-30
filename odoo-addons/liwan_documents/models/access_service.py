# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset(
    {
        'documents.items.read',
        'documents.items.manage',
        'documents.items.archive',
        'documents.access.manage',
        'documents.library.manage',
    },
)
DEPENDENCIES = {
    'documents.items.manage': {'documents.items.read'},
    'documents.items.archive': {'documents.items.manage'},
    'documents.access.manage': {'documents.items.manage'},
    'documents.library.manage': {'documents.items.read'},
}


class DocumentsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_documents'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        return {**dependencies, **DEPENDENCIES}

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role, keys in (
            ('liwan_documents.role_documents_manager', PERMISSIONS),
            ('liwan_core.role_employee', {'documents.items.read'}),
            ('liwan_core.role_vendor_support', PERMISSIONS),
        ):
            grants[role] = grants.get(role, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        for key in PERMISSIONS:
            group = 'liwan_documents.group_cap_' + key.replace('.', '_')
            if user.has_group(group):
                keys.add(key)
        if user.has_group('liwan_core.group_employee'):
            keys.add('documents.items.read')
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'documents_manager']

    @api.model
    def _liwan_bump_policy(self, companies):
        self.env['liwan.document.policy']._liwan_touch(companies)
        return super()._liwan_bump_policy(companies)
