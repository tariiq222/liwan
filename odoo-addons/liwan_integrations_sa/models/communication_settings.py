# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

DEFAULT_DAILY_MESSAGE_LIMIT = 1000
MAX_DAILY_MESSAGE_LIMIT = 100000
DEFAULT_DAILY_CALL_LIMIT = 200
MAX_DAILY_CALL_LIMIT = 10000


class LiwanIntegrationSettings(models.Model):
    """The communication safety settings of one company: they protect its provider balance from a runaway loop.

    A company without a row uses the defaults; the first change creates its row.
    """
    _name = 'liwan.integration.settings'
    _description = 'LiwanOS integration communication settings'
    _liwan_scope = 'company'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    daily_message_limit = fields.Integer(required=True, default=DEFAULT_DAILY_MESSAGE_LIMIT)
    daily_call_limit = fields.Integer(required=True, default=DEFAULT_DAILY_CALL_LIMIT)
    # Recording a call needs the tenant's own legal basis (D7): off until the company turns it on.
    record_calls = fields.Boolean(default=False)

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one communication settings row')
    _daily_message_limit_range = models.Constraint(
        f'CHECK(daily_message_limit BETWEEN 1 AND {MAX_DAILY_MESSAGE_LIMIT})',
        f'the daily message limit is between 1 and {MAX_DAILY_MESSAGE_LIMIT}',
    )
    _daily_call_limit_range = models.Constraint(
        f'CHECK(daily_call_limit BETWEEN 1 AND {MAX_DAILY_CALL_LIMIT})',
        f'the daily call limit is between 1 and {MAX_DAILY_CALL_LIMIT}',
    )

    @api.model
    def _liwan_for_company(self, company):
        """The settings row of ``company``, or an empty recordset when it still uses the defaults."""
        return self.search([('company_id', '=', company.id)], limit=1)

    @api.model
    def _liwan_values(self, company):
        row = self._liwan_for_company(company)
        return {
            'daily_message_limit': row.daily_message_limit if row else DEFAULT_DAILY_MESSAGE_LIMIT,
            'daily_call_limit': row.daily_call_limit if row else DEFAULT_DAILY_CALL_LIMIT,
            'record_calls': row.record_calls if row else False,
        }

    @api.model
    def _liwan_update(self, company, values):
        row = self._liwan_for_company(company)
        if row:
            row.write(values)
        else:
            self.create({'company_id': company.id, **values})
        return self._liwan_values(company)
