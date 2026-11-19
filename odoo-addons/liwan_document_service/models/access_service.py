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
            {'key': key, 'owner': 'liwan_document_service'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        return {**dependencies, **DEPENDENCIES}

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        role = 'liwan_core.role_employee'
        grants[role] = grants.get(role, set()) | {'documents.items.read'}
        return grants

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        # Vendor support holds no documents permission, inside a support session or outside it
        # (owner decision 2026-11-19, #729): its foundation shortcut grants the whole catalog, so it is stripped here.
        return keys - PERMISSIONS if user.has_group('liwan_core.group_vendor_support') else keys

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        for key in PERMISSIONS:
            group = 'liwan_document_service.group_cap_' + key.replace('.', '_')
            if user.has_group(group):
                keys.add(key)
        if user.has_group('liwan_core.group_employee'):
            keys.add('documents.items.read')
        return keys

    @api.model
    def _liwan_bump_policy(self, companies):
        self.env['liwan.document.policy']._liwan_touch(companies)
        return super()._liwan_bump_policy(companies)
