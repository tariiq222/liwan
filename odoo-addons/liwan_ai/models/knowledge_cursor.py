# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanAiKnowledgeCursor(models.Model):
    """How far the bootstrap scan has read one knowledge source in one company: the id of the last record it queued.

    After the knowledge is turned on, or the index rebuilt, the indexer reads every existing record in id order; this
    cursor is where it stopped. Changes after that are not found by scanning: the bridges mark them in
    ``liwan.ai.knowledge.pending`` in the transaction that makes them. The rebuild action clears the cursors. The company
    is not called ``company_id`` on purpose: this table belongs to the tenant, and a ``company_id`` would put it behind
    the per-company access fence that the technical indexer user only passes in one company.
    """
    _name = 'liwan.ai.knowledge.cursor'
    _description = 'LiwanOS AI knowledge bootstrap cursor'
    _liwan_scope = 'tenant'

    model = fields.Char(required=True)
    source_company_id = fields.Many2one('res.company', required=True, ondelete='cascade')
    last_id = fields.Integer(required=True)

    _model_company_unique = models.Constraint('UNIQUE(model, source_company_id)', 'one cursor per source model and company')

    @api.model
    def _liwan_last_id(self, model, company):
        return self.search([('model', '=', model), ('source_company_id', '=', company.id)]).last_id

    @api.model
    def _liwan_advance(self, model, company, last_id):
        cursor = self.search([('model', '=', model), ('source_company_id', '=', company.id)])
        if cursor:
            cursor.last_id = last_id
        else:
            self.create({'model': model, 'source_company_id': company.id, 'last_id': last_id})
