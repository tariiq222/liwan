# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_document_service.models.access_service import PERMISSIONS


class DocumentsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        role = 'liwan_documents.role_documents_manager'
        grants[role] = grants.get(role, set()) | PERMISSIONS
        return grants

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'documents_manager']
