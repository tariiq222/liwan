# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

DEFAULT_CONNECTIONS = (('zatca', 'ZATCA'),)


class LiwanIntegrationConnection(models.Model):
    """Status of one live link of a company (ZATCA e-invoicing, a bank).

    Status only: this model stores no credential and makes no network call.

    Rows are seeded on install and on every upgrade of the addon, for the companies that exist
    at that moment. There is no `res.company` create hook (it would need `sudo()`): the
    provisioning flow upgrades this addon after it creates a company, and the page's empty
    state covers the gap until then.
    """
    _name = 'liwan.integration.connection'
    _description = 'LiwanOS integration connection'
    _liwan_scope = 'company'
    _order = 'kind, provider, id'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    kind = fields.Selection([('zatca', 'ZATCA'), ('bank', 'Bank')], required=True)
    provider = fields.Char(required=True)
    state = fields.Selection(
        [('not_configured', 'Not configured'), ('pending', 'Pending'), ('connected', 'Connected'), ('error', 'Error')],
        required=True, default='not_configured',
    )
    last_checked = fields.Datetime()
    status_message = fields.Char()

    _company_kind_provider_unique = models.Constraint(
        'UNIQUE(company_id, kind, provider)', 'a company has one connection per kind and provider',
    )

    @api.model
    def _liwan_ensure_default_connections(self):
        """Give every company its default connections (one ZATCA link); idempotent, run by module data."""
        existing = {
            (row['company_id'], row['kind'], row['provider'])
            for row in self.search_read([], ['company_id', 'kind', 'provider'], load=None)
        }
        self.create([
            {'company_id': company_id, 'kind': kind, 'provider': provider}
            for company_id in self.env['res.company'].search([]).ids
            for kind, provider in DEFAULT_CONNECTIONS if (company_id, kind, provider) not in existing
        ])

    @api.model
    def _liwan_set_connection_state(self, company, kind, provider, state, message):
        """Record the state of one live link of ``company``; the link is created when it is missing.

        Applications call this when their own flow changes a link (finance after a ZATCA onboarding).
        It adds no elevation of its own: the caller's environment must be allowed to write the model,
        and the message is a short status text, never a credential or a raw provider response.
        """
        vals = {'state': state, 'status_message': message, 'last_checked': fields.Datetime.now()}
        connection = self.search([('company_id', '=', company.id), ('kind', '=', kind), ('provider', '=', provider)], limit=1)
        if connection:
            connection.write(vals)
            return connection
        return self.create({'company_id': company.id, 'kind': kind, 'provider': provider, **vals})
