# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanAiKnowledgePending(models.Model):
    """A record of a knowledge source that changed and is waiting for the indexer.

    The bridge of a source marks the record in the transaction that changes it, so a transaction that commits late
    still leaves its row behind (a ``write_date`` cursor would have passed it). One row per record: marking it again
    only refreshes its company. The indexer claims the rows, deleting them in its own transaction, and builds the
    record's text from its state at that moment.

    The mark is a single insert into this table with ``ON CONFLICT``: the writer needs no read access to the table (an
    ordinary user holds none), no row of a concurrent transaction can make its write fail, and the whole thing costs one
    statement. The table is this model's own; no stock Odoo table is touched. The company is not called ``company_id`` on
    purpose, as on the cursor: it would put the table behind the per-company access fence.
    """
    _name = 'liwan.ai.knowledge.pending'
    _description = 'LiwanOS AI knowledge index pending record'
    _liwan_scope = 'tenant'
    _log_access = False
    _order = 'id'

    model = fields.Char(required=True)
    res_id = fields.Integer(required=True)
    source_company_id = fields.Many2one('res.company', ondelete='cascade')

    _record_unique = models.Constraint('UNIQUE(model, res_id)', 'one pending row per record')

    @api.model
    def _liwan_mark(self, records):
        """Mark ``records`` as changed, unless the knowledge is off (one statement, no access check)."""
        if not records:
            return
        self.env['liwan.ai.settings'].flush_model(['knowledge_enabled'])
        self.env.cr.execute(
            'INSERT INTO liwan_ai_knowledge_pending (model, res_id, source_company_id)'
            ' SELECT %s, record.id, record.company_id FROM unnest(%s::int[], %s::int[]) AS record(id, company_id)'
            ' WHERE EXISTS (SELECT 1 FROM liwan_ai_settings WHERE knowledge_enabled)'
            ' ON CONFLICT (model, res_id) DO UPDATE SET source_company_id = EXCLUDED.source_company_id',
            [records._name, records.ids, [record.company_id.id or None for record in records]],
        )
