# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models

RETENTION = timedelta(days=2)


class LiwanFinanceIdempotency(models.Model):
    """The answer to a creating request that carried an ``Idempotency-Key``, kept so a retry gets the same answer.

    A client that loses the response to a payment or an invoice can send the request again with the same key: the first
    answer is replayed and nothing is created twice. The key is unique per company; a row is created in the same
    transaction as the record it protects, so a refused request leaves no key behind. Rows are kept two days.
    """
    _name = 'liwan.finance.idempotency'
    _description = 'LiwanOS finance idempotency key'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    key = fields.Char(required=True, index=True)
    method = fields.Char(required=True)
    path = fields.Char(required=True)
    user_id = fields.Many2one('res.users', required=True, ondelete='cascade')
    request_hash = fields.Char(required=True)
    status = fields.Integer()
    body = fields.Text()

    _key_unique = models.Constraint('unique(company_id, key)', 'The idempotency key is already used.')

    @api.model
    def _liwan_purge(self):
        """Forget the keys older than the retention of the current company."""
        self.search([
            ('company_id', '=', self.env.company.id), ('create_date', '<', fields.Datetime.now() - RETENTION),
        ]).unlink()
