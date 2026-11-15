# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .access_service import DOCUMENTS_ASSIGN, READ


class ResUsers(models.Model):
    _inherit = 'res.users'

    # Read by the record rules of security/sales_rules.xml. Capability groups are the union over all the user's
    # companies, so each rule scopes every company by one of these instead. Not stored: the rule domain is cached, and
    # saving the setting or a capability change clears that cache, so the next request computes them afresh.
    # The companies whose whole order book this user reads: where they hold sales.documents.assign, and where they
    # hold sales.read while the tenant's visibility setting is `all`.
    liwan_sales_open_company_ids = fields.Many2many('res.company', compute='_compute_liwan_sales_company_ids')
    # The companies where this user holds sales.documents.assign, so writes every document.
    liwan_sales_assign_company_ids = fields.Many2many('res.company', compute='_compute_liwan_sales_company_ids')

    def _compute_liwan_sales_company_ids(self):
        service = self.env['liwan.access.service']
        everyone_reads = self.env['liwan.sales.settings']._liwan_current().visibility == 'all'
        for user in self:
            keys = {company: service._liwan_capability_keys(user, company=company) for company in user.company_ids}
            assign = user.company_ids.filtered(lambda company, keys=keys: DOCUMENTS_ASSIGN in keys[company])
            user.liwan_sales_assign_company_ids = assign
            user.liwan_sales_open_company_ids = assign | user.company_ids.filtered(
                lambda company, keys=keys: everyone_reads and READ in keys[company],
            )
