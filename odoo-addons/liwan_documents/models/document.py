# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.tools import SQL


class Document(models.Model):
    _inherit = 'liwan.document'

    @api.model
    def _liwan_scope_predicate(self, operation):
        return SQL('TRUE')
