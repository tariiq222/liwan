# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.tools import SQL


class Document(models.Model):
    _inherit = 'liwan.document'

    @api.model
    def _liwan_scope_predicate(self, operation):
        entitlement = self.env['liwan.entitlement.service']
        feature = entitlement._liwan_feature_read if operation == 'read' else entitlement._liwan_feature_write
        if feature('documents.enabled'):
            return SQL('TRUE')
        return super()._liwan_scope_predicate(operation)
