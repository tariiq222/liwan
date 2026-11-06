# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanAiKnowledgeCursor(models.Model):
    """How far the indexer has read one knowledge source in one company: the ``write_date`` and id of the last record it queued.

    A record is queued again whenever its ``(write_date, id)`` is past the cursor, so the pair is a total order that
    survives records written in the same instant. The rebuild action clears the cursors. The company is not called
    ``company_id`` on purpose: this table belongs to the tenant, and a ``company_id`` would put it behind the
    per-company access fence that the technical indexer user only passes in one company.
    """
    _name = 'liwan.ai.knowledge.cursor'
    _description = 'LiwanOS AI knowledge index cursor'
    _liwan_scope = 'tenant'

    model = fields.Char(required=True)
    source_company_id = fields.Many2one('res.company', required=True, ondelete='cascade')
    write_date_cursor = fields.Datetime(required=True)
    last_id = fields.Integer(required=True)

    _model_company_unique = models.Constraint('UNIQUE(model, source_company_id)', 'one cursor per source model and company')

    @api.model
    def _liwan_cursor(self, model, company):
        return self.search([('model', '=', model), ('source_company_id', '=', company.id)])

    @api.model
    def _liwan_domain_after(self, model, company):
        """The domain of the records past the cursor of ``model`` in ``company``: all of them while it has none."""
        cursor = self._liwan_cursor(model, company)
        if not cursor:
            return []
        return ['|', ('write_date', '>', cursor.write_date_cursor),
                '&', ('write_date', '=', cursor.write_date_cursor), ('id', '>', cursor.last_id)]

    @api.model
    def _liwan_advance(self, model, company, record):
        values = {'write_date_cursor': record.write_date, 'last_id': record.id}
        cursor = self._liwan_cursor(model, company)
        if cursor:
            cursor.write(values)
        else:
            self.create({'model': model, 'source_company_id': company.id, **values})
