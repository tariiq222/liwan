# Part of Odoo. See LICENSE file for full copyright and licensing details.
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models


class LiwanCrmViewLog(models.Model):
    """One opening of an opportunity's detail, written only by the explicit ``POST /opportunities/<id>/seen``
    route while ``view_log_enabled`` is on, and deleted past the company's ``view_log_retention_months``."""

    _name = 'liwan.crm.view.log'
    _description = 'LiwanOS CRM view log'
    _order = 'viewed_at desc, id desc'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='cascade')
    lead_id = fields.Many2one('crm.lead', required=True, index=True, ondelete='cascade')
    viewed_at = fields.Datetime(required=True, default=fields.Datetime.now, index=True)

    @api.model
    def _liwan_record(self, lead):
        """Log this opening when the company enabled the log; a GET never reaches this."""
        settings = self.env['liwan.crm.settings'].with_company(lead.company_id)._liwan_effective()
        if settings['view_log_enabled']:
            self.create({'company_id': lead.company_id.id, 'user_id': self.env.uid, 'lead_id': lead.id})

    @api.model
    def _liwan_prune(self, now=None):
        """Delete the rows older than each company's retention window; the cron runs this once a day.

        Only companies that actually hold rows are visited: the table, not the company list, decides.
        """
        now = now or fields.Datetime.now()
        Settings = self.env['liwan.crm.settings']
        for company, in self._read_group([], ['company_id']):
            months = Settings.with_company(company)._liwan_effective()['view_log_retention_months']
            self.search([
                ('company_id', '=', company.id), ('viewed_at', '<', now - relativedelta(months=months)),
            ]).unlink()
